# STADVDB MCO2 - Movie Database System

A unified movie database web application with distributed MySQL backend, built for STADVDB (Advanced Database Systems) course.

## Project Overview

This project implements a complete movie database management system with:
- **Web Interface**: EJS templates with Bootstrap styling
- **REST API**: Express.js backend with distributed database support
- **Database**: 3-node MySQL cluster with SSH tunnel support
- **Unified Architecture**: Single application serving both web interface and API

## Architecture

```
STADVDB_MCO2/
├── main.js                 # Unified Express application entry point
├── package.json           # Single dependency management
├── .env                   # Environment configuration
├── client/
│   ├── public/           # Static assets (CSS, JS, images)
│   └── views/            # EJS templates
│       ├── layout.ejs    # Main layout template
│       ├── movies/       # Movie-specific views
│       ├── error.ejs     # Error pages
│       └── 404.ejs       # Not found page
├── server/src/
│   ├── models/           # Data models with distributed DB
│   ├── routes/           # API routes
│   ├── services/         # SSH tunnel management
│   └── scripts/          # Database utilities
└── README.md
```

## How to Run

### Quick Start
```powershell
npm install
npm start
```

The application will be available at: http://localhost:3000

### Development Mode
```powershell
npm install
npm run dev
```

Uses nodemon for automatic restarts during development.

### Available URLs
- **Web Interface**: http://localhost:3000/movies
- **API Endpoints**: http://localhost:3000/api/movies
- **Health Check**: http://localhost:3000/api/health

## Database Configuration

### Connection Modes

#### 1. Mock Data Mode (Default)
Uses in-memory data for development and testing:
```env
DB_MODE=mock
```

#### 2. Direct Database Mode
Direct connection to MySQL servers:
```env
DB_MODE=direct
DB_HOST=103.231.240.130
```

#### 3. SSH Tunnel Mode
Secure connection through SSH tunnels:
```env
DB_MODE=ssh
SSH_HOST=103.231.240.130
SSH_PORTS=60454,60455,60456
```

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

### Web Interface Features
- **Responsive UI**: Bootstrap-based design
- **Movie Listing**: Paginated table with search/filter
- **CRUD Operations**: Create, read, update, delete movies
- **Form Validation**: Client and server-side validation
- **Error Handling**: User-friendly error pages

### API Features
- **REST API**: Complete CRUD endpoints
- **Distributed DB**: 3-node MySQL cluster support
- **SSH Tunneling**: Secure database connections
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

### Web Routes
- `GET /` - Redirect to movies listing
- `GET /movies` - Movies listing page
- `GET /movies/:id` - Movie details page
- `GET /movies/new` - New movie form
- `GET /movies/:id/edit` - Edit movie form
- `POST /movies` - Create movie (form submission)
- `POST /movies/:id` - Update movie (form submission)
- `POST /movies/:id/delete` - Delete movie
- `GET /search` - Search movies

## Database Distribution Strategy

### Node Distribution (Year-based Partitioning)
- **Server 0** (Port 60754): Central node with full dataset
- **Server 1** (Port 60755): Fragment for even tconst numbers
- **Server 2** (Port 60756): Fragment for odd tconst numbers

### Connection Strategy
1. **Direct Connection**: Attempt direct MySQL connections first
2. **SSH Tunnel Fallback**: Use SSH tunnels if direct fails
3. **Mock Data Fallback**: Use in-memory data if all connections fail

### SSH Configuration
- **Server 0 SSH**: Port 60454 → MySQL 3306
- **Server 1 SSH**: Port 60455 → MySQL 3306 (if available)
- **Server 2 SSH**: Port 60456 → MySQL 3306

## Scripts

### Available Scripts
```powershell
npm start          # Production server
npm run dev        # Development with nodemon
npm run health     # Check database health
npm run discover   # Discover database structure
```

## Technology Stack

### Core Technologies
- **Express.js** - Web framework
- **EJS** - Template engine
- **MySQL2** - Database driver
- **Bootstrap 5** - CSS framework

### Additional Libraries
- **SSH2** - SSH tunnel connections
- **CORS** - Cross-origin support
- **dotenv** - Environment configuration
- **express-ejs-layouts** - Layout support
- **method-override** - HTTP verb support

## Environment Configuration

### Main Configuration (.env)
```env
PORT=3000
NODE_ENV=development
FRONTEND_URL=http://localhost:3000

# Database Configuration
DB_MODE=mock

# Server 0 - Central node
DB0_HOST=ccscloud.dlsu.edu.ph
DB0_PORT=60754
DB0_USER=root
DB0_PASSWORD=y4CUW63BZdM9Jr7QEjnGfxtR
DB0_DATABASE=mco2

# SSH Configuration
SSH0_HOST=103.231.240.130
SSH0_PORT=60454
SSH2_HOST=103.231.240.130
SSH2_PORT=60456
```

## Development

### Local Development Setup
1. Clone the repository
2. Install dependencies: `npm install`
3. Configure environment variables in `.env`
4. Start development server: `npm run dev`
5. Access application at http://localhost:3000

### Production Deployment
1. Configure production environment variables
2. Install dependencies: `npm install --production`
3. Start application: `npm start`
4. Configure reverse proxy if needed

## Project Structure Benefits

### Unified Architecture
- **Single Entry Point**: One main.js file handles everything
- **Simplified Deployment**: Deploy one application instead of two
- **No CORS Issues**: API and web interface on same origin
- **Unified Dependencies**: Single package.json management

### Development Efficiency
- **Hot Reloading**: Nodemon for automatic restarts
- **Mock Data**: Develop without database dependencies
- **Error Handling**: Comprehensive error pages and API responses
- **Health Monitoring**: Built-in database health checks

## Troubleshooting

### Common Issues
1. **Port conflicts**: Ensure port 3000 is available
2. **Database connection**: Check VPN for DLSU cloud access
3. **SSH tunnel errors**: Verify SSH credentials and ports
4. **Permission errors**: Port 3306 may require admin privileges

### Health Checks
- **Application health**: http://localhost:3000/api/health
- **Database status**: Check console logs during startup
- **Connection mode**: Look for "mock", "direct", or "ssh" mode messages

### Debug Information
- **Connection attempts**: Monitor console for connection testing
- **Fallback behavior**: Application automatically falls back to mock data
- **Error logging**: All errors are logged with context