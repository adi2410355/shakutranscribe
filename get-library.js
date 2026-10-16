// netlify/functions/get-library.js
exports.handler = async function (event, context) {
  const SITE_ID = process.env.SITE_ID;
  const TOKEN = process.env.NETLIFY_API_TOKEN;

  // If the token isn't set yet, return an empty list gracefully
  if (!SITE_ID || !TOKEN) {
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify([])
    };
  }

  try {
    // Fetch only VERIFIED (non-spam) submissions for this site from Netlify's API
    const response = await fetch(
      `https://api.netlify.com/api/v1/sites/${SITE_ID}/submissions?per_page=100`,
      {
        headers: {
          Authorization: `Bearer ${TOKEN}`,
          "Content-Type": "application/json"
        }
      }
    );

    if (!response.ok) {
      return { statusCode: 200, body: JSON.stringify([]) };
    }

    const submissions = await response.json();

    // Filter for our form and extract the clean score object
    const verifiedPieces = submissions
      .filter(sub => sub.form_name === "repository-submissions" && sub.data)
      .map(sub => {
        try {
          if (sub.data.json_entry) {
            return JSON.parse(sub.data.json_entry);
          }
          return {
            id: "netlify-" + sub.id,
            title: sub.data.title || "Untitled",
            flute: sub.data.flute || "62",
            transpose: 0,
            timesig: "4",
            abc: sub.data.abc_data || ""
          };
        } catch (e) {
          return null;
        }
      })
      .filter(item => item && item.abc);

    return {
      statusCode: 200,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store"
      },
      body: JSON.stringify(verifiedPieces)
    };
  } catch (error) {
    return {
      statusCode: 200,
      body: JSON.stringify([])
    };
  }
};
