// netlify/functions/dynamic-qr-handler.js

// IMPORTANT: You'll need to install your database client library
// For example, if using FaunaDB: npm install faunadb
// If using MongoDB: npm install mongodb
// For production, connect your database client *outside* the handler
// to reuse connections across invocations for better performance.

// const faunadb = require('faunadb');
// const q = faunadb.query;
// const client = new faunadb.Client({ secret: process.env.FAUNADB_SERVER_SECRET });

exports.handler = async (event, context) => {
    if (event.httpMethod !== 'GET' && event.httpMethod !== 'POST') {
        return {
            statusCode: 405,
            body: JSON.stringify({ error: 'Method Not Allowed', message: 'Only GET and POST requests are accepted.' }),
        };
    }

    const qrId = event.path.split('/').pop(); // Extract ID from URL path (e.g., /dynamic-qr/my-id -> my-id)

    // --- Dynamic QR GET (for QR scans) ---
    if (event.httpMethod === 'GET') {
        if (!qrId || qrId === 'dynamic-qr-handler') { // Catch cases where /dynamic-qr-handler is called directly
            return {
                statusCode: 400,
                body: 'Missing QR ID for redirection. Usage: /.netlify/functions/dynamic-qr-handler/YOUR_QR_ID',
            };
        }

        let targetUrl;

        // --- TODO: REPLACE WITH REAL DATABASE LOOKUP ---
        // In a real SaaS, you'd query your database here for the targetUrl based on qrId
        // Example (conceptual FaunaDB query):
        /*
        try {
            const result = await client.query(
                q.Get(q.Match(q.Index('dynamic_qrs_by_id'), qrId))
            );
            targetUrl = result.data.url;
            console.log(`Dynamic QR ID "${qrId}" found in DB. Redirecting to: ${targetUrl}`);

            // TODO: Log scan to database for analytics
            // await client.query(
            //     q.Create(q.Collection('qr_scans'), {
            //         data: {
            //             qrId: qrId,
            //             timestamp: new Date().toISOString(),
            //             ip: event.headers['client-ip'],
            //             userAgent: event.headers['user-agent'],
            //             // Add more context like referrer, approximate geo-location etc.
            //         },
            //     })
            // );

        } catch (dbError) {
            console.warn(`Dynamic QR ID "${qrId}" not found in DB or DB error:`, dbError);
            // Fallback to a default URL or a 404 page if not found in DB
            targetUrl = process.env.DEFAULT_DYNAMIC_QR_FALLBACK_URL || "https://ai.google.dev/gemini-api/docs";
        }
        */

        // For MVP, if no DB connected, use a simple fallback or mock data
        const mockQrCodeMappings = {
            "product-promo-june": "https://www.example.com/summer-sale-2025",
            "event-signup-2025": "https://www.eventbrite.com/your-event-signup-2025",
            "saas-launch-promo": "https://your-saas-marketing-page.com/welcome",
            "default-link": process.env.DEFAULT_DYNAMIC_QR_FALLBACK_URL || "https://ai.google.dev/gemini-api/docs"
        };
        targetUrl = mockQrCodeMappings[qrId] || mockQrCodeMappings["default-link"];


        // Increment local analytics count (conceptual, for real data, use DB)
        // This is primarily for the frontend analytics tab, not true backend analytics
        try {
             // You cannot directly update frontend local storage from a Netlify function.
             // This scan logging needs to happen client-side OR in a real DB.
             // For the serverless function, just log to console or a real DB.
            console.log(`GET request for dynamic QR ID: ${qrId}, redirecting to: ${targetUrl}`);
        } catch (e) { /* ignore */ }


        return {
            statusCode: 302, // 302 Found (Temporary Redirect)
            headers: {
                'Location': targetUrl,
                'Cache-Control': 'no-cache, no-store, must-revalidate', // Ensure fresh redirect
                'Pragma': 'no-cache',
                'Expires': '0',
            },
            body: '',
        };
    }

    // --- Dynamic QR POST (for managing QRs from the frontend) ---
    if (event.httpMethod === 'POST') {
        let requestBody;
        try {
            requestBody = JSON.parse(event.body);
        } catch (e) {
            return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON body' }) };
        }

        const { action, qrData } = requestBody;
        if (!action) {
            return { statusCode: 400, body: JSON.stringify({ error: 'Missing action in request body' }) };
        }

        // --- TODO: IMPLEMENT USER AUTHENTICATION HERE ---
        // Only authenticated users should be able to manage QRs.
        // You'd check a token in event.headers or context.clientContext.user

        // Example: if (!context.clientContext.user) {
        //     return { statusCode: 401, body: JSON.stringify({ error: 'Unauthorized', message: 'Login required.' }) };
        // }

        try {
            switch (action) {
                case 'create':
                case 'update':
                    // qrData should contain { id, url, userId (from auth) }
                    if (!qrData || !qrData.id || !qrData.url) {
                        return { statusCode: 400, body: JSON.stringify({ error: 'Missing qrData for create/update' }) };
                    }
                    // --- TODO: SAVE/UPDATE TO DATABASE ---
                    // Example (conceptual FaunaDB):
                    /*
                    await client.query(
                        q.If(
                            q.Exists(q.Match(q.Index('dynamic_qrs_by_id'), qrData.id)),
                            q.Replace(
                                q.Select('ref', q.Get(q.Match(q.Index('dynamic_qrs_by_id'), qrData.id))),
                                { data: { id: qrData.id, url: qrData.url, userId: context.clientContext.user.sub, createdAt: q.If(q.Exists(q.Match(q.Index('dynamic_qrs_by_id'), qrData.id)), q.Select(['data', 'createdAt'], q.Get(q.Match(q.Index('dynamic_qrs_by_id'), qrData.id))), q.Now()), updatedAt: q.Now() } }
                            ),
                            q.Create(q.Collection('dynamic_qrs'), { data: { id: qrData.id, url: qrData.url, userId: context.clientContext.user.sub, createdAt: q.Now(), updatedAt: q.Now() } })
                        )
                    );
                    */
                    console.log(`${action} dynamic QR: ${qrData.id} with URL ${qrData.url}`);
                    return { statusCode: 200, body: JSON.stringify({ status: 'success', message: `${action}d dynamic QR successfully.` }) };

                case 'delete':
                    if (!qrData || !qrData.id) {
                        return { statusCode: 400, body: JSON.stringify({ error: 'Missing qrData.id for delete' }) };
                    }
                    // --- TODO: DELETE FROM DATABASE ---
                    /*
                    await client.query(
                        q.Delete(q.Select('ref', q.Get(q.Match(q.Index('dynamic_qrs_by_id'), qrData.id))))
                    );
                    */
                    console.log(`Deleted dynamic QR: ${qrData.id}`);
                    return { statusCode: 200, body: JSON.stringify({ status: 'success', message: 'Deleted dynamic QR successfully.' }) });

                case 'list':
                    // --- TODO: LIST FROM DATABASE (for current user) ---
                    /*
                    const result = await client.query(
                        q.Map(
                            q.Paginate(q.Match(q.Index('dynamic_qrs_by_user_id'), context.clientContext.user.sub)),
                            q.Lambda('qrRef', q.Get(q.Var('qrRef')))
                        )
                    );
                    const qrs = result.data.map(item => ({ id: item.data.id, url: item.data.url, createdAt: item.data.createdAt }));
                    */
                    console.log('Listing dynamic QRs (mock)');
                    // Mock data for listing
                    const mockList = [
                        { id: "saas-launch-promo", url: "https://your-saas-marketing-page.com/welcome", createdAt: new Date().toISOString() },
                        { id: "my-product-guide", url: "https://your-site.com/guide", createdAt: new Date().toISOString() }
                    ];
                    return { statusCode: 200, body: JSON.stringify({ status: 'success', data: mockList }) };

                default:
                    return { statusCode: 400, body: JSON.stringify({ error: 'Unknown action' }) };
            }
        } catch (error) {
            console.error('Error handling dynamic QR action:', error);
            return {
                statusCode: 500,
                body: JSON.stringify({
                    error: 'Internal Server Error',
                    message: error.message,
                }),
            };
        }
    }
};

