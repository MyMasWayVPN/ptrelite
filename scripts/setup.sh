#!/bin/bash

# Web Hosting Panel - Setup Script
# Script untuk setup awal project

set -e

echo "🚀 Setting up Web Hosting Panel..."

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

# Check if required tools are installed
check_requirements() {
    print_status "Checking requirements..."
    
    # Check Node.js
    if ! command -v node &> /dev/null; then
        print_error "Node.js is not installed. Please install Node.js 18+ first."
        exit 1
    fi
    
    NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
    if [ "$NODE_VERSION" -lt 18 ]; then
        print_error "Node.js version 18+ is required. Current version: $(node -v)"
        exit 1
    fi
    
    # Check npm
    if ! command -v npm &> /dev/null; then
        print_error "npm is not installed."
        exit 1
    fi
    
    # Check Docker
    if ! command -v docker &> /dev/null; then
        print_warning "Docker is not installed. Some features may not work."
    fi
    
    # Check Docker Compose
    if ! command -v docker-compose &> /dev/null && ! docker compose version &> /dev/null; then
        print_warning "Docker Compose is not installed. Some features may not work."
    fi
    
    print_success "Requirements check completed"
}

# Setup environment files
setup_env() {
    print_status "Setting up environment files..."
    
    # Copy .env.example to .env if not exists
    if [ ! -f .env ]; then
        cp .env.example .env
        print_success "Created .env file from .env.example"
        print_warning "Please update .env file with your configuration"
    else
        print_warning ".env file already exists, skipping..."
    fi
    
    # Create backend .env if not exists
    if [ ! -f backend/.env ]; then
        cp .env backend/.env
        print_success "Created backend/.env file"
    else
        print_warning "backend/.env file already exists, skipping..."
    fi
}

# Install dependencies
install_dependencies() {
    print_status "Installing dependencies..."
    
    # Install root dependencies
    print_status "Installing root dependencies..."
    npm install
    
    # Install backend dependencies
    print_status "Installing backend dependencies..."
    cd backend
    npm install
    cd ..
    
    # Install frontend dependencies
    print_status "Installing frontend dependencies..."
    cd frontend
    npm install
    cd ..
    
    print_success "All dependencies installed"
}

# Setup database
setup_database() {
    print_status "Setting up database..."
    
    # Check if Docker is running
    if docker info &> /dev/null; then
        print_status "Starting database with Docker..."
        docker-compose up -d postgres redis
        
        # Wait for database to be ready
        print_status "Waiting for database to be ready..."
        sleep 10
        
        # Run database migrations
        print_status "Running database migrations..."
        cd backend
        npx prisma migrate dev --name init
        
        # Generate Prisma client
        print_status "Generating Prisma client..."
        npx prisma generate
        
        # Seed database
        print_status "Seeding database..."
        npx prisma db seed
        cd ..
        
        print_success "Database setup completed"
    else
        print_warning "Docker is not running. Please start Docker and run database setup manually:"
        print_warning "  docker-compose up -d postgres redis"
        print_warning "  cd backend && npx prisma migrate dev && npx prisma db seed"
    fi
}

# Create necessary directories
create_directories() {
    print_status "Creating necessary directories..."
    
    mkdir -p logs
    mkdir -p data/uploads
    mkdir -p data/containers
    
    print_success "Directories created"
}

# Setup Git hooks (optional)
setup_git_hooks() {
    if [ -d .git ]; then
        print_status "Setting up Git hooks..."
        
        # Create pre-commit hook
        cat > .git/hooks/pre-commit << 'EOF'
#!/bin/bash
# Run linting before commit
npm run lint
EOF
        chmod +x .git/hooks/pre-commit
        
        print_success "Git hooks setup completed"
    fi
}

# Main setup function
main() {
    echo "=================================="
    echo "  Web Hosting Panel Setup"
    echo "=================================="
    echo ""
    
    check_requirements
    echo ""
    
    setup_env
    echo ""
    
    install_dependencies
    echo ""
    
    create_directories
    echo ""
    
    setup_database
    echo ""
    
    setup_git_hooks
    echo ""
    
    print_success "Setup completed successfully! 🎉"
    echo ""
    echo "Next steps:"
    echo "1. Update .env file with your configuration"
    echo "2. Start the development server: npm run dev"
    echo "3. Open http://localhost:3000 in your browser"
    echo ""
    echo "Default accounts:"
    echo "  Admin: admin / admin123"
    echo "  Member: member / member123"
    echo ""
    echo "For more information, see README.md"
}

# Run main function
main "$@"
