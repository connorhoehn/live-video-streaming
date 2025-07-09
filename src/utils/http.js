const http = require('http');
const https = require('https');
const { URL } = require('url');

exports.makeHttpRequest = (urlOrOptions, bodyOrOptions = {}) => {
  return new Promise((resolve, reject) => {
    let requestOptions;
    
    // Handle both parameter styles
    if (typeof urlOrOptions === 'string') {
      // New style: makeHttpRequest(url, options)
      const urlObj = new URL(urlOrOptions);
      const httpModule = urlObj.protocol === 'https:' ? https : http;
      
      requestOptions = {
        hostname: urlObj.hostname,
        port: urlObj.port,
        path: urlObj.pathname + urlObj.search,
        method: bodyOrOptions.method || 'GET',
        headers: {
          'Content-Type': 'application/json',
          ...bodyOrOptions.headers,
        },
      };
    } else {
      // Old style: makeHttpRequest(options, body)
      const httpModule = urlOrOptions.protocol === 'https:' ? https : http;
      
      requestOptions = {
        hostname: urlOrOptions.hostname,
        port: urlOrOptions.port,
        path: urlOrOptions.path,
        method: urlOrOptions.method || 'GET',
        headers: {
          'Content-Type': 'application/json',
          ...urlOrOptions.headers,
        },
      };
    }
    
    const httpModule = requestOptions.port === 443 ? https : http;

    const req = httpModule.request(requestOptions, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        
        try {
          // Return raw data for compatibility with mesh code
          resolve(data);
        } catch (e) {
          reject(e);
        }
      });
    });

    req.on('error', reject);

    // Handle body data
    const bodyData = typeof urlOrOptions === 'string' ? bodyOrOptions.body : bodyOrOptions;
    if (bodyData) {
      const bodyString = typeof bodyData === 'string' ? bodyData : JSON.stringify(bodyData);
      // console.log(`📤 [HTTP] Sending body:`, {
      //   type: typeof bodyData,
      //   length: bodyString.length,
      //   content: bodyString
      // });
      req.write(bodyString);
    }

    req.end();
  });
};

exports.retryOperation = async (operation, maxRetries = 3, delay = 1000) => {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      console.warn(`⚠️ Attempt ${attempt}/${maxRetries} failed:`, error.message);
      if (attempt === maxRetries) throw error;
      await new Promise((res) => setTimeout(res, delay * attempt));
    }
  }
};
