#!/bin/bash
# Production Deployment Script for Agentix
# Usage: ./deploy-production.sh [environment]

set -e

ENVIRONMENT=${1:-production}
AWS_REGION=${AWS_REGION:-us-east-1}
ECR_REGISTRY=${ECR_REGISTRY:-}
PROJECT_NAME="agentix"

echo "=================================================="
echo "Agentix Production Deployment"
echo "Environment: $ENVIRONMENT"
echo "Region: $AWS_REGION"
echo "=================================================="

# Check prerequisites
command -v aws >/dev/null 2>&1 || { echo "AWS CLI required"; exit 1; }
command -v docker >/dev/null 2>&1 || { echo "Docker required"; exit 1; }

# Set up environment-specific variables
if [ "$ENVIRONMENT" = "production" ]; then
    ECR_REGISTRY="public.ecr.aws/agentix"
    DATABASE_URL="${AWS_RDS_URL:-$DATABASE_URL}"
    REDIS_URL="${AWS_ELASTICACHE_URL:-$REDIS_URL}"
else
    ECR_REGISTRY="public.ecr.aws/agentix-dev"
fi

BACKEND_URL="${BACKEND_URL:-https://api.agentix.example.com}"
FRONTEND_URL="${FRONTEND_URL:-https://app.agentix.example.com}"

# Build and push Docker images
build_and_push() {
    local service=$1
    local dockerfile=$2
    local context=$3

    echo "Building $service..."
    docker build -t $PROJECT_NAME/$service:latest -f $dockerfile $context

    # Tag for ECR
    docker tag $PROJECT_NAME/$service:latest $ECR_REGISTRY/$service:latest

    echo "Pushing $service to ECR..."
    docker push $ECR_REGISTRY/$service:latest
}

# Build all services
echo "Building Docker images..."
build_and_push "backend" "backend/Dockerfile" "backend"
build_and_push "frontend" "frontend/Dockerfile" "frontend"

# Update ECS services
if [ "$ENVIRONMENT" = "production" ]; then
    echo "Updating ECS services..."

    # Update backend service
    aws ecs update-service \
        --cluster agentix-cluster \
        --service agentix-backend \
        --force-new-deployment \
        --region $AWS_REGION

    # Update frontend service
    aws ecs update-service \
        --cluster agentix-cluster \
        --service agentix-frontend \
        --force-new-deployment \
        --region $AWS_REGION
fi

# Run database migrations
echo "Running database migrations..."
# Add migration commands here

[ -n "$DATABASE_URL" ] || { echo "DATABASE_URL or AWS_RDS_URL is required"; exit 1; }
[ -n "$REDIS_URL" ] || { echo "REDIS_URL or AWS_ELASTICACHE_URL is required"; exit 1; }

# Health check
echo "Waiting for services to be healthy..."
sleep 30

# Verify deployment
echo "Verifying deployment..."
curl -f "$BACKEND_URL/health" || { echo "Backend health check failed"; exit 1; }
curl -f "$FRONTEND_URL/" || { echo "Frontend health check failed"; exit 1; }

echo "=================================================="
echo "Deployment complete!"
echo "=================================================="
