// Netlify Serverless Function: Fetches verified score submissions from Netlify Forms
exports.handler = async (event) => {
  const headers = {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store, max-age=0'
  };

  const siteId = process.env.SITE_ID || process.env.NETLIFY_SITE_ID;
  const token =
    process.env.NETLIFY_ACCESS_TOKEN ||
    process.env.NETLIFY_AUTH_TOKEN ||
    process.env.NETLIFY_API_TOKEN ||
    process.env.NETLIFY_TOKEN ||
    process.env.ACCESS_TOKEN;

  const isDebug = event.queryStringParameters && event.queryStringParameters.debug === '1';

  if (!siteId || !token) {
    if (isDebug) {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          status: 'missing_credentials',
          hasSiteId: Boolean(siteId),
          hasToken: Boolean(token),
          help: 'In Netlify Dashboard -> Site configuration -> Environment variables, ensure NETLIFY_ACCESS_TOKEN (Personal Access Token) is set.'
        }, null, 2)
      };
    }
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify([])
    };
  }

  try {
    const response = await fetch(
      `https://api.netlify.com/api/v1/sites/${siteId}/submissions?per_page=100`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      }
    );

    if (!response.ok) {
      if (isDebug) {
        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({
            status: 'netlify_api_error',
            httpStatus: response.status,
            statusText: response.statusText
          }, null, 2)
        };
      }
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify([])
      };
    }

    const submissions = await response.json();
    const verifiedScores = [];

    if (Array.isArray(submissions)) {
      // Oldest first so newer submissions preserve chronological order
      const ordered = [...submissions].reverse();

      for (const sub of ordered) {
        const data = sub.data || {};
        // Accept submissions from 'repository-submissions' form
        if (sub.form_name && sub.form_name !== 'repository-submissions') continue;

        let entry = null;
        if (data.json_entry) {
          try {
            entry = JSON.parse(data.json_entry);
          } catch (e) {
            entry = null;
          }
        }

        if (!entry && (data.title || data.abc_data)) {
          const rawTitle = (data.title || 'Untitled').trim();
          const composer = (data.composer || '').trim();
          const fullTitle = composer && !rawTitle.includes(composer) ? `${rawTitle} — ${composer}` : rawTitle;
          entry = {
            id: fullTitle.toLowerCase().replace(/[^a-z0-9]+/g, '-') + '-' + (sub.id || Date.now()),
            title: fullTitle,
            contributor: (data.contributor || '').trim(),
            flute: data.flute || '62',
            transpose: 0,
            timesig: '4',
            abc: (data.abc_data || '').trim()
          };
        }

        if (entry && entry.title && entry.abc) {
          verifiedScores.push(entry);
        }
      }
    }

    if (isDebug) {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          status: 'ok',
          totalSubmissionsFound: Array.isArray(submissions) ? submissions.length : 0,
          verifiedScoresCount: verifiedScores.length,
          verifiedScores
        }, null, 2)
      };
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify(verifiedScores)
    };
  } catch (err) {
    if (isDebug) {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ status: 'exception', message: err.message }, null, 2)
      };
    }
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify([])
    };
  }
};
