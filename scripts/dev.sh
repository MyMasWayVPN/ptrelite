#!/bin/bash

# Web Hosting Panel - Development Script
# Script untuk menjalankan development server

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Function to print colored output
print_status() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Function to check if port is in use
check_port() {
    local port=$1
    if lsof -Pi :$port -sTCP:LISTEN -t >/dev/null 2>&1; then
        return 0
    else
        return 1
    fi
}

# Function to start services
start_services() {
    print_status "Starting development services..."
    
    # Check if Docker is running
    if ! docker info &> /dev/null; then
        print_error "Docker is not running. Please start Docker first."
        exit 1
    fi
    
    # Start database and Redis
    print_status "Starting database and Redis..."
    docker-compose up -d postgres redis
    
    # Wait for services to be ready
    print_status "Waiting for services to be ready..."
    sleep 5
    
    # Check if database is ready
    local retries=0
    local max_retries=30
    
    while [ $retries -lt $max_retries ]; do
        if docker-compose exec -T postgres pg_isready -U panel_user -d panel_db &> /dev/null; then
            print_success "Database is ready"
            break
        fi
        
        retries=$((retries + 1))
        print_status "Waiting for database... ($retries/$max_retries)"
        sleep 2
    done
    
    if [ $retries -eq $max_retries ]; then
        print_error "Database failed to start"
        exit 1
    fi
    
    # Check if Redis is ready
    if docker-compose exec -T redis redis-cli ping &> /dev/null; then
        print_success "Redis is ready"
    else
        print_warning "Redis may not be ready"
    fi
}

# Function to run database migrations
run_migrations() {
    print_status "Running database migrations..."
    
    cd backend
    
    # Generate Prisma client
    npx prisma generate
    
    # Run migrations
    npx prisma migrate dev
    
    # Seed database if needed
    if [ "$1" = "--seed" ]; then
        print_status "Seeding database..."
        npx prisma db seed
    fi
    
    cd ..
    
    print_success "Database migrations completed"
}

# Function to start development servers
start_dev_servers() {
    print_status "Starting development servers..."
    
    # Check if ports are available
    if check_port 3000; then
        print_warning "Port 3000 is already in use (Frontend)"
    fi
    
    if check_port 5000; then
        print_warning "Port 5000 is already in use (Backend)"
    fi
    
    # Start both frontend and backend
    print_status "Starting frontend and backend servers..."
    npm run dev
}

# Function to show status
show_status() {
    echo ""
    echo "=================================="
    echo "  Development Server Status"
    echo "=================================="
    echo ""
    
    # Check Docker services
    print_status "Docker Services:"
    docker-compose ps
    echo ""
    
    # Check ports
    print_status "Port Status:"
    if check_port 3000; then
        print_success "Frontend: http://localhost:3000"
    else
        print_warning "Frontend: Not running"
    fi
    
    if check_port 5000; then
        print_success "Backend: http://localhost:5000"
    else
        print_warning "Backend: Not running"
    fi
    
    if check_port 5432; then
        print_success "Database: localhost:5432"
    else
        print_warning "Database: Not running"
    fi
    
    if check_port 6379; then
        print_success "Redis: localhost:6379"
    else
        print_warning "Redis: Not running"
    fi
    
    echo ""
    print_status "Default Accounts:"
    echo "  Admin: admin / admin123"
    echo "  Member: member / member123"
    echo ""
}

# Function to stop services
stop_services() {
    print_status "Stopping development services..."
    
    # Stop Docker services
    docker-compose down
    
    # Kill any remaining processes on our ports
    for port in 3000 5000; do
        if check_port $port; then
            print_status "Killing process on port $port..."
            lsof -ti:$port | xargs kill -9 2>/dev/null || true
        fi
    done
    
    print_success "Services stopped"
}

# Function to restart services
restart_services() {
    print_status "Restarting development services..."
    stop_services
    sleep 2
    start_services
    print_success "Services restarted"
}

# Function to show logs
show_logs() {
    local service=$1
    
    if [ -z "$service" ]; then
        print_status "Showing all Docker logs..."
        docker-compose logs -f
    else
        print_status "Showing logs for $service..."
        docker-compose logs -f $service
    fi
}

# Function to clean up
cleanup() {
    print_status "Cleaning up development environment..."
    
    # Stop services
    stop_services
    
    # Remove Docker volumes (optional)
    if [ "$1" = "--volumes" ]; then
        print_warning "Removing Docker volumes (this will delete all data)..."
        docker-compose down -v
    fi
    
    # Clean node_modules (optional)
    if [ "$1" = "--deps" ] || [ "$2" = "--deps" ]; then
        print_status "Cleaning dependencies..."
        rm -rf node_modules backend/node_modules frontend/node_modules
        print_success "Dependencies cleaned"
    fi
    
    print_success "Cleanup completed"
}

# Function to show help
show_help() {
    echo "Web Hosting Panel - Development Script"
    echo ""
    echo "Usage: $0 [COMMAND] [OPTIONS]"
    echo ""
    echo "Commands:"
    echo "  start           Start all development services"
    echo "  stop            Stop all development services"
    echo "  restart         Restart all development services"
    echo "  status          Show status of all services"
    echo "  logs [service]  Show logs (optionally for specific service)"
    echo "  migrate         Run database migrations"
    echo "  seed            Run database migrations and seed"
    echo "  clean           Clean up development environment"
    echo "  help            Show this help message"
    echo ""
    echo "Options:"
    echo "  --volumes       Remove Docker volumes (with clean command)"
    echo "  --deps          Remove node_modules (with clean command)"
    echo ""
    echo "Examples:"
    echo "  $0 start                    # Start all services"
    echo "  $0 logs backend            # Show backend logs"
    echo "  $0 clean --volumes --deps  # Full cleanup"
    echo ""
}

# Main function
main() {
    local command=${1:-start}
    
    case $command in
        start)
            start_services
            run_migrations
            start_dev_servers
            ;;
        stop)
            stop_services
            ;;
        restart)
            restart_services
            ;;
        status)
            show_status
            ;;
        logs)
            show_logs $2
            ;;
        migrate)
            start_services
            run_migrations
            ;;
        seed)
            start_services
            run_migrations --seed
            ;;
        clean)
            cleanup $2 $3
            ;;
        help|--help|-h)
            show_help
            ;;
        *)
            print_error "Unknown command: $command"
            echo ""
            show_help
            exit 1
            ;;
    esac
}

# Handle Ctrl+C gracefully
trap 'echo ""; print_warning "Interrupted by user"; exit 130' INT

# Run main function
main "$@"
