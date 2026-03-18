# Build stage
FROM golang:1.24-alpine AS builder

# Install build dependencies
RUN apk add --no-cache git

WORKDIR /app

# Copy go.mod (go.sum may not exist yet)
COPY go.mod go.sum* ./

# Copy the source code
COPY . .

# Resolve dependencies and generate go.sum
RUN go mod tidy

# Build the application
RUN CGO_ENABLED=0 GOOS=linux go build -o main .

# Production stage
FROM alpine:latest

# Add CA certificates for HTTPS requests
RUN apk --no-cache add ca-certificates

WORKDIR /root/

# Copy the binary from the builder stage
COPY --from=builder /app/main .

# Create uploads directory
RUN mkdir -p /data/uploads

# Expose the port the app runs on
EXPOSE 8080

# Run the binary
CMD ["./main"]
