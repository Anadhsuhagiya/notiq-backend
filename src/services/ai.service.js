const { google } = require('googleapis');
const logger = require('../utils/logger');

// Cache for the auth client
let authClient = null;

const getAuthClient = async () => {
  if (authClient) return authClient;
  try {
    let auth;
    if (process.env.GOOGLE_CREDENTIALS_JSON) {
      auth = new google.auth.GoogleAuth({
        credentials: JSON.parse(process.env.GOOGLE_CREDENTIALS_JSON),
        scopes: ['https://www.googleapis.com/auth/generative-language', 'https://www.googleapis.com/auth/cloud-platform'],
      });
    } else {
      auth = new google.auth.GoogleAuth({
        keyFile: process.env.GOOGLE_APPLICATION_CREDENTIALS || 'service-account.json',
        scopes: ['https://www.googleapis.com/auth/generative-language', 'https://www.googleapis.com/auth/cloud-platform'],
      });
    }
    authClient = await auth.getClient();
    return authClient;
  } catch (error) {
    logger.error('Failed to initialize AI Auth Client:', error);
    return null;
  }
};

const PATTERNS = {
  OTP: [/\b\d{4,8}\b.*(otp|verification|code|pin)/i],
};

const extractAmount = (text) => {
  const m = text.match(/[₹Rs]\.?\s*([\d,]+(?:\.\d{2})?)/i);
  return m ? Math.round(parseFloat(m[1].replace(/,/g, '')) * 100) : null;
};

const callGemini = async (text) => {
  try {
    const client = await getAuthClient();
    if (!client) return null;

    const prompt = `Task: Analyze the following notification text and return a precise JSON object.
    Rules:
    1. Categories: PAYMENT_DUE, MEETING, TASK, OTP, PROMOTIONAL, SOCIAL, OTHER.
    2. Extract payment amount in Paise (Indian currency sub-unit) if present.
    3. Extract due dates in ISO 8601 format.
    4. Extract meeting links (Zoom, Meet, etc.).
    5. Determine urgency (0 to 1).
    6. isTransient is true for OTPs or ephemeral notifications.
    
    Notification Text: "${text.replace(/"/g, "'")}"
    
    Response Format (JSON only):
    {
      "category": "STRING",
      "confidence": NUMBER,
      "isTransient": BOOLEAN,
      "entities": {
        "amount": NUMBER_OR_NULL,
        "dueDate": "ISO_STRING_OR_NULL",
        "meetingLink": "URL_OR_NULL",
        "urgencyScore": NUMBER,
        "summary": "STRING"
      }
    }`;

    const response = await client.request({
      url: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent',
      method: 'POST',
      data: {
        contents: [{ parts: [{ text: prompt }] }]
      }
    });

    const content = response.data.candidates[0].content.parts[0].text;
    return JSON.parse(content.replace(/```json|```/g, '').trim());
  } catch (error) {
    const msg = error.response?.data?.error?.message || error.message || 'Unknown AI error';
    logger.error('AI Analysis Error:', msg);
    return null;
  }
};

const classifyNotification = async (title = '', body = '') => {
  const text = `${title} ${body}`.trim();
  
  // High-performance check for OTPs (avoid AI cost/latency)
  if (PATTERNS.OTP.some(p => p.test(text))) {
    return {
      category: 'OTP',
      confidence: 1.0,
      isTransient: true,
      entities: { urgencyScore: 1.0, summary: 'Verification Code' }
    };
  }

  // Use Gemini for deep analysis
  const geminiResult = await callGemini(text);
  if (geminiResult) return geminiResult;

  // Final Fallback
  return {
    category: 'OTHER',
    confidence: 0.3,
    isTransient: false,
    entities: {
      amount: extractAmount(text),
      urgencyScore: 0.1
    }
  };
};

const classifyBatch = async (notifications) => {
  // Process in small chunks to respect rate limits and optimize performance
  const results = [];
  for (let i = 0; i < notifications.length; i += 5) {
    const chunk = notifications.slice(i, i + 5);
    const analyzed = await Promise.all(chunk.map(async (n) => ({
      ...n,
      ...(await classifyNotification(n.title, n.body))
    })));
    results.push(...analyzed);
  }
  return results;
};

const computeFingerprint = (senderKey, amount, dueDate) => {
  if (!senderKey && !amount && !dueDate) return null;
  const raw = `${senderKey || ''}_${amount || ''}_${dueDate || ''}`;
  return require('crypto').createHash('md5').update(raw).digest('hex');
};

const generateInsight = async (prompt) => {
  try {
    const client = await getAuthClient();
    if (!client) return { globalSummary: "Auth failed", personWise: [] };

    const response = await client.request({
      url: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent',
      method: 'POST',
      data: {
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { responseMimeType: "application/json" }
      }
    });

    const text = response.data.candidates[0].content.parts[0].text;
    return JSON.parse(text.replace(/```json|```/g, '').trim());
  } catch (err) {
    const msg = err.response?.data?.error?.message || err.message || 'Unknown Insight error';
    logger.error('AI Insight Generation Error:', msg);
    return { globalSummary: "Error generating insight.", personWise: [] };
  }
};

module.exports = { classifyNotification, classifyBatch, computeFingerprint, generateInsight };
