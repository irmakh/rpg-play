#!/bin/bash
# Docker development startup script

echo "🐳 Starting Character Sheet Development Container..."

# Check if .env exists
if [ ! -f .env ]; then
    echo "⚠️  No .env file found. Creating from .env.docker template..."
    cp .env.docker .env
    echo "📝 Please edit .env with your actual credentials before continuing."
    exit 1
fi

# Build and start containers
echo "🔨 Building Docker image..."
docker-compose build

echo "🚀 Starting container..."
docker-compose up -d

echo ""
echo "✅ Container started successfully!"
echo ""
echo "📍 Application running at: http://localhost:${HOST_PORT:-3000}"
echo ""
echo "Useful commands:"
echo "  docker-compose logs -f          # View logs"
echo "  docker-compose exec app sh      # Access container shell"
echo "  docker-compose down             # Stop container"
echo "  docker-compose restart          # Restart container"
echo ""
