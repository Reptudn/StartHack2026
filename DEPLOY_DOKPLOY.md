# Deploying HealthMap to Dokploy

Da du Dokploy anstelle von Docker Compose nutzen möchtest, kannst du die Services als einzelne Apps anlegen.

Die Applikation besteht aus 3 Teilen:
1. **PostgreSQL Datenbank**
2. **Go API Backend**
3. **React Frontend (Web)**

Hier ist die Schritt-für-Schritt-Anleitung, wie du alles in Dokploy aufsetzt.

---

## 1. Datenbank erstellen (PostgreSQL)

1. Gehe in Dokploy in dein Project/Environment.
2. Klicke auf **Create Service > Create Database**.
3. Wähle **PostgreSQL**.
4. Setze folgende Werte:
   - **Name:** `healthmap-db`
   - **Database Name:** `healthmap`
   - **Database User:** `healthmap`
   - **Database Password:** `healthmap_prod_secure` (Wähle hier ein eigenes)
   - **Version:** `16` (oder was als Default vorgeschlagen wird)
5. Klicke auf **Deploy**.
6. Kopiere dir den *Internal Hostname* (meistens gleich dem Namen, also `healthmap-db`).

---

## 2. Go API Backend erstellen

Das Backend stellt die Endpunkte bereit und verbindet sich mit der Datenbank.

1. Klicke auf **Create Service > Create Application**.
2. **Name:** `healthmap-api`
3. **Source:** Wähle dein Git-Repository aus und setze den Branch (z.B. `main`).
4. **Build Type:** Wähle `Dockerfile`.
5. **Context Path:** `/api`
6. **Dockerfile Path:** `Dockerfile` (relativ zum Context Path).
7. Gehe in den Reiter **Environment** und füge folgende Variablen hinzu:
   ```env
   APP_ENV=production
   PORT=8080
   DB_HOST=healthmap-db # <-- Der interne Name deiner Datenbank aus Schritt 1
   DB_PORT=5432
   DB_USER=healthmap
   DB_PASSWORD=healthmap_prod_secure # <-- Passwort aus Schritt 1
   DB_NAME=healthmap
   DB_SSLMODE=disable # Bei interner Verbindung in Dokploy meist disable
   CORS_ORIGINS=https://dataunifier.toletolemeimei.de
   MAX_UPLOAD_MB=100
   ```
8. Gehe in den Reiter **Network/Ports**:
   - Container Port `8080` eintragen.
   - Domain-Name: `api.toletolemeimei.de` eintragen (und Zertifikat aktivieren).
9. Gehe in den Reiter **Storage/Volumes**:
   - Erstelle ein Volume:
   - Volume Name: `healthmap-uploads`
   - Mount Path: `/data/uploads`
   - *Ohne dieses Volume gehen hochgeladene Dateien bei jedem API-Neustart verloren!*
10. Klicke auf **Deploy**.

Wähle nun diese API-Domain und öffne sie im Browser: `https://api.toletolemeimei.de/api/health`. Du solltest `{"status":"ok", ...}` sehen.

---

## 3. React Frontend erstellen (Web)

Das Frontend wurde so umgebaut, dass es die API-URL zur **Laufzeit** via Environment Variable aufnimmt. Das bedeutet, du musst es für Dokploy nicht neu bauen, sondern das Docker-Entrypoint-Skript erledigt das Ersetzen beim Start des Nginx-Containers.

1. Klicke auf **Create Service > Create Application**.
2. **Name:** `healthmap-web`
3. **Source:** Wähle dein Git-Repository aus und setze den Branch (z.B. `main`).
4. **Build Type:** Wähle `Dockerfile`.
5. **Context Path:** `/web`
6. **Dockerfile Path:** `Dockerfile`
7. Gehe in den Reiter **Environment** und füge diese eine Variable hinzu:
   ```env
   # WICHTIG: Kein Slash (/) am Ende!
   VITE_API_URL=https://api.toletolemeimei.de
   ```
8. Gehe in den Reiter **Network/Ports**:
   - Mappe Container Port `4242` nach außen.
   - Domain-Name: `dataunifier.toletolemeimei.de` eintragen (und Zertifikat aktivieren).
9. Klicke auf **Deploy**.

## 🚀 Fertig!

Wenn allesdeployed ist:
1. Das Frontend ruft die öffentliche API-URL aus `VITE_API_URL` auf.
2. Das API-Backend erlaubt dem Frontend-Origin den Zugriff via `CORS_ORIGINS`.
3. Das API-Backend verbindet sich intern mit der PostgreSQL-Datenbank über `DB_HOST`.
