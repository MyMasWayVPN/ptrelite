# Web Hosting Panel

Panel hosting web full-stack yang dapat menjalankan script Python & JavaScript di dalam container Docker dengan fitur lengkap untuk manajemen container, console web, file manager, dan integrasi Cloudflare Tunnel.

## 🚀 Fitur Utama

### Autentikasi & Otorisasi
- Login dengan JWT + refresh token
- Role-based access control (Admin & Member)
- Session management yang aman

### Panel Admin (`/admin`)
- Manajemen user (create, edit, delete)
- Akses ke semua container
- Reset password dan manajemen akun
- Audit logs dan monitoring

### Panel Member (`/member`)
- Manajemen container pribadi (limit 1 container)
- Dashboard personal
- Pengaturan akun sendiri

### Console Web (`/console/{id}`)
- Terminal web real-time via WebSocket
- Monitoring resource (CPU, RAM, Disk)
- Control container (start/stop/restart)
- Elapsed time tracking untuk script yang berjalan

### File Manager (`/manager/{id}`)
- CRUD file dan folder
- Upload/download file
- Compress/extract archive (zip, tar, gz)
- Path traversal protection

### Cloudflare Tunnel (`/cf-tunnels/{id}`)
- Install dan konfigurasi cloudflared
- Toggle on/off tunnel
- Domain mapping dan port forwarding

### Docker Management (`/docker-switch/{id}`)
- Ganti Docker image
- Pull image baru dan recreate container
- Rollback jika image baru gagal

## 🛠 Tech Stack

- **Backend**: Node.js + Express + Dockerode
- **Frontend**: React + Tailwind CSS + Vite
- **Database**: PostgreSQL + Prisma ORM
- **Authentication**: JWT + bcrypt
- **WebSocket**: Socket.io
- **Background Jobs**: Redis + BullMQ
- **Containerization**: Docker + Docker Compose

## 📋 Prerequisites

- Node.js 18+
- Docker & Docker Compose
- PostgreSQL (via Docker)
- Redis (via Docker)

## 🚀 Quick Start

### 1. Clone dan Setup
```bash
git clone <repo-url>
cd panel
cp .env.example .env
```

### 2. Install Dependencies
```bash
# Backend
cd backend
npm install

# Frontend
cd ../frontend
npm install
```

### 3. Setup Database
```bash
cd backend
npx prisma migrate dev
npx prisma db seed
```

### 4. Start Services
```bash
# Start database dan Redis
docker-compose up -d postgres redis

# Start development servers
npm run dev
```

### 5. Akses Aplikasi
- Frontend: http://localhost:3000
- Backend API: http://localhost:5000
- Database: localhost:5432

## 👤 Default Accounts

### Admin Account
- Username: `admin`
- Password: `admin123`
- Role: `admin`

### Member Account
- Username: `member`
- Password: `member123`
- Role: `member`

## 🔧 Development

### VS Code Setup
Project ini sudah dikonfigurasi untuk VS Code dengan:
- Debugging configuration
- Recommended extensions
- Workspace settings
- Integrated terminal tasks

### Available Scripts

```bash
# Development
npm run dev              # Start backend + frontend
npm run dev:backend      # Backend only
npm run dev:frontend     # Frontend only

# Production
npm run build           # Build frontend
npm run start           # Start production server

# Database
npm run db:migrate      # Run migrations
npm run db:seed         # Seed database
npm run db:reset        # Reset database

# Docker
npm run docker:up       # Start all services
npm run docker:down     # Stop all services
npm run docker:logs     # View logs
```

## 📁 Project Structure

```
panel/
├── backend/                    # Node.js API server
│   ├── src/
│   │   ├── controllers/       # Route controllers
│   │   ├── middleware/        # Auth, validation, etc
│   │   ├── models/           # Database models
│   │   ├── routes/           # API routes
│   │   ├── services/         # Business logic
│   │   ├── utils/            # Utilities
│   │   └── websocket/        # Socket.io handlers
│   ├── prisma/               # Database schema
│   └── package.json
├── frontend/                   # React application
│   ├── src/
│   │   ├── components/       # Reusable components
│   │   ├── pages/           # Page components
│   │   ├── hooks/           # Custom hooks
│   │   ├── services/        # API services
│   │   ├── store/           # State management
│   │   └── utils/           # Utilities
│   └── package.json
├── .vscode/                   # VS Code configuration
├── docker-compose.yml         # Docker orchestration
├── .env.example              # Environment template
└── README.md
```

## 🔒 Security Considerations

### ⚠️ Important Security Issues

1. **Container Escape Risk**
   - Running untrusted Docker images dapat membahayakan host system
   - **Mitigasi**: Gunakan user namespaces, resource limits, dan network isolation

2. **Path Traversal**
   - File manager dapat dieksploitasi untuk akses file di luar container
   - **Mitigasi**: Strict path validation dan chroot jail

3. **Command Injection**
   - Console web dapat digunakan untuk command injection
   - **Mitigasi**: Input sanitization dan command whitelisting

4. **Resource Exhaustion**
   - Container dapat menghabiskan resource host
   - **Mitigasi**: CPU/memory limits dan monitoring

### 🛡️ Implemented Security Measures

- JWT dengan refresh token rotation
- Password hashing dengan bcrypt
- Rate limiting pada endpoints kritis
- Input validation dan sanitization
- RBAC enforcement di backend
- Container resource limits
- Audit logging

## 🧪 Testing

```bash
# Backend tests
cd backend
npm test

# Frontend tests
cd frontend
npm test

# Integration tests
npm run test:integration
```

## 📚 API Documentation

API documentation tersedia di `/api/docs` setelah server berjalan, atau lihat file `docs/api.md`.

## 🐛 Known Issues & Limitations

### PoC Limitations
1. **Cloudflare Tunnel**: Saat ini di-mock untuk demo, tidak membuat tunnel sesungguhnya
2. **Resource Monitoring**: Basic monitoring via Docker stats API
3. **File Operations**: Terbatas pada filesystem container
4. **Background Jobs**: Sederhana tanpa persistence queue

### Production Considerations
1. Implementasi real Cloudflare Tunnel API
2. Advanced resource monitoring dengan Prometheus
3. Distributed file storage
4. Queue persistence dengan Redis
5. Load balancing dan high availability
6. Enhanced security scanning

## 🤝 Contributing

1. Fork repository
2. Create feature branch
3. Commit changes
4. Push to branch
5. Create Pull Request

## 📄 License

MIT License - lihat file LICENSE untuk detail.

## 🆘 Support

Jika mengalami masalah:
1. Cek logs: `docker-compose logs`
2. Restart services: `docker-compose restart`
3. Reset database: `npm run db:reset`
4. Buka issue di repository

---

**⚠️ Disclaimer**: Aplikasi ini untuk development dan testing. Untuk production, implementasikan security measures tambahan dan review kode secara menyeluruh.
