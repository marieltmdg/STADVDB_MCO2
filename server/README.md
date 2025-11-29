# STADVDB MCO2 - Backend API

Backend REST API for the Movie Database System built with Express.js and MySQL distributed database support.

## Features

- **RESTful API**: Complete CRUD operations for movies
- **Distributed Database**: Support for 3-node MySQL cluster
- **Mock Data Mode**: Development mode with in-memory data
- **Error Handling**: Comprehensive error handling and logging
- **CORS Support**: Cross-origin resource sharing for frontend integration

## API Endpoints

### Movies
- `GET /api/movies` - Get all movies
- `GET /api/movies/:id` - Get movie by ID
- `POST /api/movies` - Create new movie
- `PUT /api/movies/:id` - Update movie
- `DELETE /api/movies/:id` - Delete movie
- `GET /api/movies/search` - Search movies with query parameters

### Health Check
- `GET /api/health` - API health status

## Installation

1. **Install dependencies:**
   ```powershell
   npm install
   ```

2. **Configure environment:**
   ```powershell
   Copy-Item .env.example .env
   ```
   Edit `.env` file with your configuration.

3. **Start the server:**
   ```powershell
   # Development mode
   npm run dev
   
   # Production mode
   npm start
   ```

## Environment Variables

```
PORT=3001
NODE_ENV=development
FRONTEND_URL=http://localhost:3000

# Database Configuration
DB_MODE=mock
DB_HOST_NODE1=ccscloud.dlsu.edu.ph
DB_PORT_NODE1=60754
DB_HOST_NODE2=ccscloud.dlsu.edu.ph
DB_PORT_NODE2=60755
DB_HOST_NODE3=ccscloud.dlsu.edu.ph
DB_PORT_NODE3=60756
DB_USER=root
DB_PASSWORD=password
DB_NAME=stadvdb_mco2
```

## Database Schema

### Movies Table
| Field | Type | Description |
|-------|------|-------------|
| tconst | VARCHAR(20) | Primary key (e.g., tt0123456) |
| titleType | VARCHAR(50) | Type of title (movie, tvSeries, etc.) |
| primaryTitle | VARCHAR(255) | Main title |
| originalTitle | VARCHAR(255) | Original title |
| isAdult | BOOLEAN | Adult content flag |
| startYear | INT | Release year |
| endYear | INT | End year (for TV series) |
| runtimeMinutes | INT | Runtime in minutes |
| genres | VARCHAR(255) | Comma-separated genres |

## API Response Format

### Success Response
```json
{
  "success": true,
  "data": {...},
  "message": "Operation completed successfully"
}
```

### Error Response
```json
{
  "success": false,
  "error": "Error message"
}
```

## Scripts

- `npm start` - Start production server
- `npm run dev` - Start development server with nodemon
- `npm run health` - Check database health
- `npm run switch-db` - Switch between mock and distributed database
- `npm run init-db` - Initialize distributed database

## Architecture

```
backend/
├── src/
│   ├── app.js              # Express application setup
│   ├── controllers/        # API controllers
│   ├── models/             # Data models
│   ├── routes/             # API routes
│   ├── database/           # Database management (future)
│   └── config/             # Configuration (future)
├── package.json
└── .env
```

## Development

The backend uses mock data by default for development. To switch to distributed database:

1. **Set up VPN connection** to DLSU cloud
2. **Change DB_MODE** to `distributed` in `.env`
3. **Run health check** to verify connections:
   ```powershell
   npm run health
   ```

## Error Handling

The API includes comprehensive error handling:
- Input validation
- Database connection errors
- 404 for missing resources
- 500 for server errors
- Detailed error messages in development mode