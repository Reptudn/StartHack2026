#!/usr/bin/env python3
"""
Extract reference data from Hack2026.bak (SQL Server backup).

Spins up a temporary SQL Server container, restores the backup,
exports schema + sample rows per table as JSON reference data.

Usage:
    python scripts/extract_bak_reference.py

Output:
    ml/reference_data.json — sample rows per table for mapper prompt context
"""

import json
import subprocess
import sys
import time
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
BAK_PATH = PROJECT_ROOT / "epaCC-START-Hack-2026" / "Checkdata" / "Hack2026.bak"
OUTPUT_PATH = PROJECT_ROOT / "ml" / "reference_data.json"

CONTAINER_NAME = "healthmap-mssql-extract"
SA_PASSWORD = "Extract_Ref_2026!"
DB_NAME = "Hack2026"
SQLCMD = "/opt/mssql-tools18/bin/sqlcmd"
MAX_SAMPLE_ROWS = 5  # rows per table — enough for few-shot, not a lookup table


def run(cmd: str, check: bool = True, capture: bool = True, timeout: int = 60) -> str:
    """Run a shell command and return stdout."""
    result = subprocess.run(
        cmd, shell=True, capture_output=capture, text=True, timeout=timeout
    )
    if check and result.returncode != 0:
        print(f"FAILED: {cmd}", file=sys.stderr)
        if result.stderr:
            print(result.stderr, file=sys.stderr)
        sys.exit(1)
    return result.stdout.strip() if capture else ""


def cleanup():
    """Remove the temporary SQL Server container."""
    print("Cleaning up container...")
    run(f"docker rm -f {CONTAINER_NAME}", check=False)


def wait_for_sqlserver(max_wait: int = 90):
    """Wait until SQL Server is ready to accept connections."""
    print("Waiting for SQL Server to start...")
    for i in range(max_wait):
        result = subprocess.run(
            f'docker exec {CONTAINER_NAME} {SQLCMD} -C '
            f'-S localhost -U sa -P "{SA_PASSWORD}" -Q "SELECT 1" -b',
            shell=True, capture_output=True, text=True, timeout=10,
        )
        if result.returncode == 0:
            print(f"SQL Server ready after {i+1}s")
            return
        time.sleep(1)
    print("SQL Server failed to start", file=sys.stderr)
    cleanup()
    sys.exit(1)


def sqlcmd(query: str, timeout: int = 30) -> str:
    """Execute a T-SQL query via sqlcmd inside the container."""
    # -W trims trailing spaces, -s "|" sets column separator, -h -1 removes headers for data queries
    return run(
        f'docker exec {CONTAINER_NAME} {SQLCMD} -C '
        f'-S localhost -U sa -P "{SA_PASSWORD}" -d {DB_NAME} '
        f'-Q "{query}" -W -s "|" -h -1',
        timeout=timeout,
    )


def sqlcmd_json_rows(table: str, limit: int) -> list[dict]:
    """Query a table and return rows as list of dicts."""
    # First get column names
    col_query = (
        f"SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS "
        f"WHERE TABLE_NAME = '{table}' ORDER BY ORDINAL_POSITION"
    )
    col_output = sqlcmd(col_query)
    columns = [line.strip() for line in col_output.splitlines() if line.strip() and "rows affected" not in line.lower()]

    if not columns:
        return []

    # Query sample rows (skip identity column coId)
    data_cols = [c for c in columns if c != "coId"]
    if not data_cols:
        return []

    select_expr = ", ".join(f"CAST([{c}] AS NVARCHAR(512)) AS [{c}]" for c in data_cols)
    data_query = f"SET NOCOUNT ON; SELECT TOP {limit} {select_expr} FROM [{table}]"
    data_output = sqlcmd(data_query)

    rows = []
    for line in data_output.splitlines():
        line = line.strip()
        if not line or "rows affected" in line.lower():
            continue
        values = [v.strip() if v.strip() != "NULL" else None for v in line.split("|")]
        if len(values) == len(data_cols):
            rows.append(dict(zip(data_cols, values)))
        # Handle misaligned rows gracefully — skip them
    return rows


def main():
    if not BAK_PATH.exists():
        print(f"Backup file not found: {BAK_PATH}", file=sys.stderr)
        sys.exit(1)

    # Clean up any leftover container
    cleanup()

    # Start SQL Server container
    print("Starting SQL Server container...")
    run(
        f"docker run -d --name {CONTAINER_NAME} "
        f'-e "ACCEPT_EULA=Y" -e "MSSQL_SA_PASSWORD={SA_PASSWORD}" '
        f"-v {BAK_PATH}:/var/backups/Hack2026.bak:ro "
        f"mcr.microsoft.com/mssql/server:2022-latest"
    )

    wait_for_sqlserver()

    # Restore the backup
    print("Restoring database...")
    # First, query the logical file names from the backup
    filelist_output = run(
        f'docker exec {CONTAINER_NAME} {SQLCMD} -C '
        f'-S localhost -U sa -P "{SA_PASSWORD}" '
        f'-Q "RESTORE FILELISTONLY FROM DISK = \'/var/backups/Hack2026.bak\'" '
        f"-W -s \"|\"",
        timeout=60,
    )

    # Parse logical names from the filelist output
    logical_data = None
    logical_log = None
    for line in filelist_output.splitlines():
        parts = [p.strip() for p in line.split("|")]
        if len(parts) >= 3:
            if parts[2] == "D" and logical_data is None:
                logical_data = parts[0]
            elif parts[2] == "L" and logical_log is None:
                logical_log = parts[0]

    if not logical_data or not logical_log:
        print("Could not determine logical file names from backup", file=sys.stderr)
        print(f"Filelist output:\n{filelist_output}", file=sys.stderr)
        cleanup()
        sys.exit(1)

    print(f"Logical files: data={logical_data}, log={logical_log}")

    restore_query = (
        f"RESTORE DATABASE [{DB_NAME}] FROM DISK = '/var/backups/Hack2026.bak' "
        f"WITH MOVE '{logical_data}' TO '/var/opt/mssql/data/{DB_NAME}.mdf', "
        f"MOVE '{logical_log}' TO '/var/opt/mssql/data/{DB_NAME}_log.ldf', "
        f"REPLACE"
    )
    run(
        f'docker exec {CONTAINER_NAME} {SQLCMD} -C '
        f'-S localhost -U sa -P "{SA_PASSWORD}" '
        f'-Q "{restore_query}" -b',
        timeout=120,
    )
    print("Database restored successfully")

    # Discover tables dynamically — no hardcoded table list
    print("Discovering tables...")
    table_output = sqlcmd(
        "SET NOCOUNT ON; SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES "
        "WHERE TABLE_TYPE = 'BASE TABLE' ORDER BY TABLE_NAME"
    )
    tables = [
        line.strip()
        for line in table_output.splitlines()
        if line.strip() and "rows affected" not in line.lower()
    ]
    print(f"Found {len(tables)} tables: {tables}")

    # Extract schema + sample rows per table
    reference = {}
    for table in tables:
        print(f"Extracting {table}...")

        # Get column info (name + type)
        schema_query = (
            f"SET NOCOUNT ON; SELECT COLUMN_NAME, DATA_TYPE "
            f"FROM INFORMATION_SCHEMA.COLUMNS "
            f"WHERE TABLE_NAME = '{table}' ORDER BY ORDINAL_POSITION"
        )
        schema_output = sqlcmd(schema_query)
        columns_info = []
        for line in schema_output.splitlines():
            line = line.strip()
            if not line or "rows affected" in line.lower():
                continue
            parts = [p.strip() for p in line.split("|")]
            if len(parts) >= 2:
                columns_info.append({"name": parts[0], "type": parts[1]})

        # Get row count
        count_output = sqlcmd(f"SET NOCOUNT ON; SELECT COUNT(*) FROM [{table}]")
        row_count = 0
        for line in count_output.splitlines():
            line = line.strip()
            if line.isdigit():
                row_count = int(line)
                break

        # Get sample rows
        sample_rows = sqlcmd_json_rows(table, MAX_SAMPLE_ROWS)

        reference[table] = {
            "columns": columns_info,
            "row_count": row_count,
            "sample_rows": sample_rows,
        }
        print(f"  {len(columns_info)} columns, {row_count} rows, {len(sample_rows)} samples")

    # Write output
    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(OUTPUT_PATH, "w") as f:
        json.dump(reference, f, indent=2, ensure_ascii=False)
    print(f"\nReference data written to {OUTPUT_PATH}")
    print(f"Tables: {list(reference.keys())}")
    for t, info in reference.items():
        print(f"  {t}: {info['row_count']} rows, {len(info['columns'])} cols, {len(info['sample_rows'])} samples")

    cleanup()
    print("Done!")


if __name__ == "__main__":
    main()
