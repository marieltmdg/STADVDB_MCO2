# STADVDB MCO2 - Movie Database System

A distributed movie database system with separate frontend and backend repositories, built for STADVDB (Advanced Database Systems) course.

## Project Overview

This project implements a complete movie database management system with:
- **Frontend**: Web application with EJS templates
- **Backend**: REST API with distributed database support
- **Database**: 3-node MySQL cluster for distributed data storage

## Architecture

```
STADVDB_MCO2/
├── server/                  # REST API Server (Port 3001)
│   ├── src/
│   │   ├── app.js          # Express API server
│   │   ├── controllers/    # API controllers
│   │   ├── models/         # Data models with distributed DB
│   │   ├── routes/         # API routes
│   │   └── scripts/        # Database utilities
│   ├── package.json
│   └── .env
│
├── client/                 # Web Application (Port 3000)
│   ├── src/
│   │   ├── server.js       # Express web server
│   │   ├── controllers/    # View controllers
│   │   ├── routes/         # Web routes
│   │   └── services/       # API client
│   ├── views/              # EJS templates
│   ├── public/             # Static assets
│   ├── package.json
│   └── .env
│
└── README.md               # This file
```

## 🚀 **How to Run**

### **1. Start Server (Backend API)** 
```powershell
cd server
npm install
npm run dev
```
Server will be available at: http://localhost:3001

### **2. Start Client (Frontend Web App)**
```powershell
cd client  
npm install
npm run dev
```
Client will be available at: http://localhost:3000

### **3. Access the Application**
Visit http://localhost:3000 to use the movie database interface.

## 🗄️ **Database Setup**

### **Check Database Health**
```powershell
cd server
npm run health
```

### **Initialize Distributed Database**
```powershell
cd server
npm run init-db
```

This will:
- Create the `movies_db` database on all 3 servers
- Create the `movies` table with proper schema
- Insert sample data according to the fragmentation strategy

## Database Schema

### Movies Table Structure
| Column | Type | Description |
|--------|------|-------------|
| tconst | VARCHAR(20) | Primary key (e.g., tt0111161) |
| titleType | VARCHAR(50) | movie, tvSeries, short, etc. |
| primaryTitle | VARCHAR(255) | Main display title |
| originalTitle | VARCHAR(255) | Original language title |
| isAdult | BOOLEAN | Adult content flag (0/1) |
| startYear | INT | Release year (1880-2030) |
| endYear | INT | End year for series (nullable) |
| runtimeMinutes | INT | Duration in minutes |
| genres | VARCHAR(255) | Comma-separated genres |

## Features

### Frontend Features
- **Responsive UI**: Bootstrap-based design
- **Movie Listing**: Paginated table with search/filter
- **CRUD Operations**: Create, read, update, delete movies
- **Form Validation**: Client and server-side validation
- **Error Handling**: User-friendly error pages

### Backend Features
- **REST API**: Complete CRUD endpoints
- **Distributed DB**: 3-node MySQL cluster support
- **Mock Data**: Development mode with in-memory storage
- **Error Handling**: Comprehensive error responses
- **Health Monitoring**: Database connection health checks

## API Endpoints

### Movies API
- `GET /api/movies` - List all movies
- `GET /api/movies/:id` - Get specific movie
- `POST /api/movies` - Create new movie
- `PUT /api/movies/:id` - Update movie
- `DELETE /api/movies/:id` - Delete movie
- `GET /api/movies/search?params` - Search movies

### System API
- `GET /api/health` - API health status

## Development Modes

### Mock Data Mode (Default)
Uses in-memory data for development and testing:
```env
DB_MODE=mock
```

### Distributed Database Mode
Connects to 3-node MySQL cluster on DLSU cloud:
```env
DB_MODE=distributed
DB_HOST_NODE1=ccscloud.dlsu.edu.ph
DB_PORT_NODE1=60754
# ... additional node configurations
```

## Database Distribution Strategy

### Node Distribution (Year-based Partitioning)
- **Node 1** (Port 60754): Movies 1880-1999
- **Node 2** (Port 60755): Movies 2000-2009  
- **Node 3** (Port 60756): Movies 2010-2030

### Replication
- Each node serves as primary for its partition
- Cross-replication for fault tolerance
- Health monitoring and failover support

## Scripts

### Server Scripts
```powershell
npm start          # Production server
npm run dev        # Development with nodemon
npm run health     # Check database health
npm run init-db    # Initialize distributed database
```

### Client Scripts
```powershell
npm start          # Production server
npm run dev        # Development server
```

## Technology Stack

### Backend
- **Express.js** - Web framework
- **MySQL2** - Database driver
- **CORS** - Cross-origin support
- **dotenv** - Environment configuration

### Frontend
- **Express.js** - Web server
- **EJS** - Template engine
- **Axios** - HTTP client
- **Bootstrap 5** - CSS framework
- **Method-Override** - HTTP verb support

## Deployment

### Development
1. Start backend: `cd backend && npm run dev`
2. Start frontend: `cd frontend && npm run dev`
3. Access application at http://localhost:3000

### Production
1. Configure environment variables
2. Start backend: `cd backend && npm start`
3. Start frontend: `cd frontend && npm start`
4. Set up reverse proxy (nginx) for production routing

## Environment Configuration

### Backend (.env)
```env
PORT=3001
NODE_ENV=development
FRONTEND_URL=http://localhost:3000
DB_MODE=mock
# Database credentials for distributed mode
```

### Frontend (.env)
```env
PORT=3000
NODE_ENV=development
API_BASE_URL=http://localhost:3001/api
```

## Contributing

1. **Backend changes**: Update models, controllers, routes in `backend/src/`
2. **Frontend changes**: Update views, controllers in `frontend/src/`
3. **Database changes**: Update schema and migration scripts
4. **Testing**: Test both development and production modes

## Project Structure Benefits

### Separation of Concerns
- **Frontend**: Focuses on user interface and experience
- **Backend**: Handles business logic and data persistence
- **Database**: Manages distributed data storage

### Independent Deployment
- Frontend and backend can be deployed separately
- Different scaling strategies for each tier
- Technology stack can evolve independently

### Development Efficiency
- Teams can work on frontend/backend simultaneously
- Mock data allows frontend development without database
- Clear API contract between frontend and backend

## Troubleshooting

### Common Issues
1. **Port conflicts**: Ensure ports 3000, 3001 are available
2. **Database connection**: Check VPN for DLSU cloud access
3. **CORS errors**: Verify FRONTEND_URL in backend .env
4. **API errors**: Check backend logs and health endpoint

### Health Checks
- Backend health: http://localhost:3001/api/health
- Database health: `cd backend && npm run health`
- Frontend status: Check browser console for API errors