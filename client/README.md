# STADVDB MCO2 - Frontend Client

Frontend web application for the Movie Database System built with Express.js and EJS templating.

## Features

- **Modern UI**: Bootstrap-based responsive interface
- **EJS Templates**: Server-side rendering with layouts
- **API Integration**: Consumes backend REST API via Axios
- **CRUD Operations**: Complete movie management interface
- **Error Handling**: User-friendly error pages and messages
- **Form Validation**: Client and server-side validation

## Pages

### Movie Management
- **Movies List** (`/movies`) - View all movies in table format
- **Movie Details** (`/movies/:id`) - Detailed movie information
- **Add Movie** (`/movies/new`) - Create new movie form
- **Edit Movie** (`/movies/:id/edit`) - Update movie form

### Error Pages
- **404 Page** - Not found page
- **Error Page** - General error handling page

## Installation

1. **Install dependencies:**
   ```powershell
   npm install
   ```

2. **Configure environment:**
   ```powershell
   Copy-Item .env.example .env
   ```
   Edit `.env` file with your backend API URL.

3. **Start the server:**
   ```powershell
   # Development mode
   npm run dev
   
   # Production mode
   npm start
   ```

## Environment Variables

```
PORT=3000
NODE_ENV=development
API_BASE_URL=http://localhost:3001/api
```

## Technology Stack

- **Express.js** - Web framework
- **EJS** - Templating engine
- **Express-EJS-Layouts** - Layout support
- **Axios** - HTTP client for API calls
- **Method-Override** - HTTP verb support (PUT, DELETE)
- **Bootstrap 5** - CSS framework
- **Custom CSS** - Additional styling

## Architecture

```
frontend/
├── src/
│   ├── server.js           # Express server
│   ├── controllers/        # View controllers
│   ├── routes/             # Frontend routes
│   └── services/           # API service layer
├── views/
│   ├── layout.ejs          # Main layout template
│   ├── movies/             # Movie-related views
│   ├── 404.ejs             # Not found page
│   └── error.ejs           # Error page
├── public/
│   └── styles.css          # Custom styles
├── package.json
└── .env
```

## API Integration

The frontend communicates with the backend through a service layer:

```javascript
// src/services/api.js
const api = {
  movies: {
    getAll(),
    getById(id),
    create(movie),
    update(id, movie),
    delete(id),
    search(params)
  }
};
```

## Styling

The application uses:
- **Bootstrap 5** for responsive layout and components
- **Custom CSS** for additional styling and theming
- **Responsive design** that works on desktop and mobile

### Color Scheme
- Primary: Bootstrap blue (#0d6efd)
- Secondary: Gray (#6c757d)
- Success: Green (#198754)
- Warning: Orange (#fd7e14)
- Danger: Red (#dc3545)
- Info: Cyan (#0dcaf0)

## Form Features

### Movie Form Fields
- **tconst**: Movie ID (auto-generated if empty)
- **titleType**: Dropdown with movie types
- **primaryTitle**: Required text field
- **originalTitle**: Optional text field
- **startYear/endYear**: Number inputs with validation
- **runtimeMinutes**: Number input for duration
- **genres**: Comma-separated text input
- **isAdult**: Checkbox for adult content flag

### Validation
- Required field validation
- Number range validation (years, runtime)
- Pattern matching for movie IDs
- Client-side and server-side validation

## Development

1. **Start backend first** on port 3001
2. **Start frontend** on port 3000
3. **Visit** http://localhost:3000

The frontend will automatically proxy API requests to the backend.

## Error Handling

The frontend includes comprehensive error handling:
- API connection errors
- Form validation errors
- 404 for missing movies
- User-friendly error messages
- Error state preservation in forms