// Mock data implementation - using in-memory storage for now
// Column specification: tconst, titleType, primaryTitle, originalTitle, isAdult, startYear, endYear, runtimeMinutes, genres

let mockMovies = [
  {
    tconst: 'tt0111161',
    titleType: 'movie',
    primaryTitle: 'The Shawshank Redemption',
    originalTitle: 'The Shawshank Redemption',
    isAdult: 0,
    startYear: 1994,
    endYear: null,
    runtimeMinutes: 142,
    genres: 'Drama'
  },
  {
    tconst: 'tt0068646',
    titleType: 'movie',
    primaryTitle: 'The Godfather',
    originalTitle: 'The Godfather',
    isAdult: 0,
    startYear: 1972,
    endYear: null,
    runtimeMinutes: 175,
    genres: 'Crime,Drama'
  },
  {
    tconst: 'tt0071562',
    titleType: 'movie',
    primaryTitle: 'The Godfather: Part II',
    originalTitle: 'The Godfather: Part II',
    isAdult: 0,
    startYear: 1974,
    endYear: null,
    runtimeMinutes: 202,
    genres: 'Crime,Drama'
  },
  {
    tconst: 'tt0468569',
    titleType: 'movie',
    primaryTitle: 'The Dark Knight',
    originalTitle: 'The Dark Knight',
    isAdult: 0,
    startYear: 2008,
    endYear: null,
    runtimeMinutes: 152,
    genres: 'Action,Crime,Drama'
  },
  {
    tconst: 'tt0050083',
    titleType: 'movie',
    primaryTitle: '12 Angry Men',
    originalTitle: '12 Angry Men',
    isAdult: 0,
    startYear: 1957,
    endYear: null,
    runtimeMinutes: 96,
    genres: 'Crime,Drama'
  }
];

// Helper function to generate unique tconst
const generateTconst = () => {
  const existing = mockMovies.map(m => m.tconst);
  let id;
  do {
    id = 'tt' + Math.floor(Math.random() * 10000000).toString().padStart(7, '0');
  } while (existing.includes(id));
  return id;
};

module.exports = {
  getAll() {
    return Promise.resolve([...mockMovies].sort((a, b) => 
      (a.primaryTitle || '').localeCompare(b.primaryTitle || '', undefined, { sensitivity: 'base' })
    ));
  },

  getById(tconst) {
    const movie = mockMovies.find(m => m.tconst === tconst);
    return Promise.resolve(movie || null);
  },

  create(movie) {
    const newMovie = {
      tconst: movie.tconst || generateTconst(),
      titleType: movie.titleType || null,
      primaryTitle: movie.primaryTitle || null,
      originalTitle: movie.originalTitle || null,
      isAdult: movie.isAdult ? 1 : 0,
      startYear: movie.startYear ? Number(movie.startYear) : null,
      endYear: movie.endYear ? Number(movie.endYear) : null,
      runtimeMinutes: movie.runtimeMinutes ? Number(movie.runtimeMinutes) : null,
      genres: movie.genres || null
    };
    
    mockMovies.push(newMovie);
    return Promise.resolve(newMovie);
  },

  update(tconst, movie) {
    const index = mockMovies.findIndex(m => m.tconst === tconst);
    if (index === -1) {
      return Promise.resolve(0);
    }

    mockMovies[index] = {
      ...mockMovies[index],
      titleType: movie.titleType || null,
      primaryTitle: movie.primaryTitle || null,
      originalTitle: movie.originalTitle || null,
      isAdult: movie.isAdult ? 1 : 0,
      startYear: movie.startYear ? Number(movie.startYear) : null,
      endYear: movie.endYear ? Number(movie.endYear) : null,
      runtimeMinutes: movie.runtimeMinutes ? Number(movie.runtimeMinutes) : null,
      genres: movie.genres || null
    };

    return Promise.resolve(1);
  },

  delete(tconst) {
    const index = mockMovies.findIndex(m => m.tconst === tconst);
    if (index === -1) {
      return Promise.resolve(0);
    }

    mockMovies.splice(index, 1);
    return Promise.resolve(1);
  },

  // Additional query methods for distributed database preparation
  getByParameters(params) {
    let filtered = [...mockMovies];
    
    if (params.titleType) {
      filtered = filtered.filter(m => m.titleType === params.titleType);
    }
    if (params.startYear) {
      filtered = filtered.filter(m => m.startYear === Number(params.startYear));
    }
    if (params.genres) {
      filtered = filtered.filter(m => m.genres && m.genres.includes(params.genres));
    }
    if (params.isAdult !== undefined) {
      filtered = filtered.filter(m => m.isAdult === (params.isAdult ? 1 : 0));
    }
    
    return Promise.resolve(filtered);
  }
};
