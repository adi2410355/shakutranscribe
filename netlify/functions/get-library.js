// Netlify Serverless Function: Fetches verified score submissions from Netlify Forms
exports.handler = async (event) => {
  const headers = {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store, max-age=0'
  };

  const siteId = process.env.SITE_ID || process.env.NETLIFY_SITE_ID;
  const isDebug = event.queryStringParameters && event.queryStringParameters.debug === '1';

  const SYSTEM_KEYS = new Set([
    'PATH', 'LD_LIBRARY_PATH', 'NODE_PATH', 'LANG', 'TZ', 'SHLVL', 'PWD', '_'
  ]);

  const candidateTokens = [];
  const seenValues = new Set();

  // Pass 1: Any environment variable whose value starts with "nfp_" (Netlify Personal Access Token)
  for (const [k, v] of Object.entries(process.env)) {
    if (!v || typeof v !== 'string' || SYSTEM_KEYS.has(k)) continue;
    const trimmed = v.trim();
    if (trimmed.startsWith('nfp_') && !seenValues.has(trimmed)) {
      seenValues.add(trimmed);
      candidateTokens.push({ key: k, token: trimmed });
    }
  }

  // Pass 2: Any non-AWS, non-system variable whose key name contains TOKEN, PAT (whole word), or AUTH
  for (const [k, v] of Object.entries(process.env)) {
    if (!v || typeof v !== 'string' || SYSTEM_KEYS.has(k)) continue;
    if (k.startsWith('AWS_') || k.startsWith('LAMBDA_')) continue;
    const trimmed = v.trim();
    if (/(TOKEN|_PAT$|^PAT_|^PAT$|AUTH)/i.test(k) && !seenValues.has(trimmed)) {
      seenValues.add(trimmed);
      candidateTokens.push({ key: k, token: trimmed });
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
    let workingKey = null;
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
        envKey: candidate.key,
        tokenPrefix: candidate.token.slice(0, 6) + '...',
        httpStatus: res.status
      });

      if (res.ok) {
        response = res;
        workingKey = candidate.key;
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
          workingEnvKey: workingKey,
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
