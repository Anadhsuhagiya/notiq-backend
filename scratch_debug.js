const { google } = require('googleapis');
console.log('Keys on google:', Object.keys(google).filter(k => k.toLowerCase().includes('generative')));
const gl = google.generativelanguage || google.generativeLanguage;
console.log('generativelanguage type:', typeof google.generativelanguage);
console.log('generativeLanguage type:', typeof google.generativeLanguage);
