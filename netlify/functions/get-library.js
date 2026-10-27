// Netlify Serverless Function: Fetches verified score submissions from Netlify Forms
exports.handler = async (event) => {
  const headers = {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store, max-age=0'
  };

  const siteId = process.env.SITE_ID || process.env.NETLIFY_SITE_ID;
  const isDebug = event.queryStringParameters && event.queryStringParameters.debug === '1';

  const candidateTokens = [];
  const seenValues = new Set();

  // Pass 1: Check both Environment Variable VALUES and KEYS for "nfp_" (Netlify Personal Access Token)
  // (Supports tokens pasted into either the Value box or the Key box in Netlify UI!)
  for (const [k, v] of Object.entries(process.env)) {
    const keyTrimmed = (k || '').trim();
    const valTrimmed = typeof v === 'string' ? v.trim() : '';

    if (valTrimmed.startsWith('nfp_') && !seenValues.has(valTrimmed)) {
      seenValues.add(valTrimmed);
      candidateTokens.push({ source: `value of ${keyTrimmed}`, token: valTrimmed });
    }
    if (keyTrimmed.startsWith('nfp_') && !seenValues.has(keyTrimmed)) {
      seenValues.add(keyTrimmed);
      candidateTokens.push({ source: `key ${keyTrimmed.slice(0, 8)}...`, token: keyTrimmed });
    }
  }

  if (!siteId || candidateTokens.length === 0) {
    if (isDebug) {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          status: 'missing_credentials',
          hasSiteId: Boolean(siteId),
          candidateCount: candidateTokens.length
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
    let response = null;
    let workingSource = null;
    const tokenAttempts = [];

    for (const candidate of candidateTokens) {
      const res = await fetch(
        `https://api.netlify.com/api/v1/sites/${siteId}/submissions?per_page=100`,
        {
          headers: {
            Authorization: `Bearer ${candidate.token}`,
            'Content-Type': 'application/json'
          }
        }
      );

      tokenAttempts.push({
        source: candidate.source,
        tokenPrefix: candidate.token.slice(0, 8) + '...',
        httpStatus: res.status
      });

      if (res.ok) {
        response = res;
        workingSource = candidate.source;
        break;
      }
    }

    if (!response) {
      if (isDebug) {
        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({
            status: 'netlify_api_error',
            attempts: tokenAttempts
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
      const ordered = [...submissions].reverse();

      for (const sub of ordered) {
        const data = sub.data || {};
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
          workingToken: workingSource,
          attempts: tokenAttempts,
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
