// netlify/functions/proxy-gemini.js

const { GoogleGenerativeLanguageServiceClient } = require('@google-ai/generativelanguage');
// For local testing: npm install @google-ai/generativelanguage
// Ensure you commit the package-lock.json and node_modules for Netlify to find dependencies.

// --- Decryption Utility (Needs to match frontend) ---
async function decryptPayload(encryptedBase64Url, passphrase) {
    if (!passphrase) {
        throw new Error("Passphrase is required for decryption.");
    }
    const encoder = new TextEncoder();
    const secretBytes = encoder.encode(passphrase);
    const baseKey = await crypto.subtle.importKey("raw", secretBytes, { name: "PBKDF2" }, false, ["deriveKey"]);
    const key = await crypto.subtle.deriveKey({ name: "PBKDF2", salt: encoder.encode("ai-qr-nexus-salt"), iterations: 100000, hash: "SHA-256" }, baseKey, { name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]);

    // Convert from URL-safe Base64 to standard Base64, then to ArrayBuffer
    const base64 = encryptedBase64Url.replace(/-/g, '+').replace(/_/g, '/');
    const binaryString = atob(base64);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
    }

    const iv = bytes.slice(0, 12);
    const encryptedContent = bytes.slice(12);

    try {
        const decrypted = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, encryptedContent);
        return JSON.parse(new TextDecoder().decode(decrypted));
    } catch (error) {
        console.error("Decryption failed:", error);
        throw new Error("Decryption failed. Invalid passphrase or corrupted data.");
    }
}


exports.handler = async (event, context) => {
    if (event.httpMethod !== 'GET') { // Now primarily a GET request, as QR code embeds data
        return {
            statusCode: 405,
            body: JSON.stringify({ error: 'Method Not Allowed', message: 'Only GET requests are accepted for AI commands via QR scan.' }),
        };
    }

    // Get the Google Gemini API Key from Netlify Environment Variables
    const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
    if (!GEMINI_API_KEY) {
        console.error("GEMINI_API_KEY environment variable is not set.");
        return {
            statusCode: 500,
            body: JSON.stringify({ error: 'Server configuration error', message: 'API key not found.' }),
        };
    }

    // Get the Encryption Passphrase from Netlify Environment Variables
    // This *must* match the passphrase entered by the user during QR generation if encryption is used.
    const ENCRYPTION_PASSPHRASE = process.env.ENCRYPTION_PASSPHRASE;
    if (!ENCRYPTION_PASSPHRASE) {
         console.warn("ENCRYPTION_PASSPHRASE environment variable is not set. Decryption won't work.");
         // For production, you might want to return a 500 if encryption is expected but passphrase isn't set.
    }


    try {
        const nexusAiParam = event.queryStringParameters.nexus_ai;
        if (!nexusAiParam) {
            return {
                statusCode: 400,
                body: JSON.stringify({ error: 'Bad Request', message: 'Missing nexus_ai query parameter.' }),
            };
        }

        let commandPayload;
        // Attempt to decrypt if an encryption passphrase is set
        if (ENCRYPTION_PASSPHRASE) {
            try {
                 commandPayload = await decryptPayload(nexusAiParam, ENCRYPTION_PASSPHRASE);
                 console.log("Payload decrypted successfully.");
            } catch (decryptionError) {
                console.error("Decryption failed with provided passphrase:", decryptionError);
                // Fallback to base64 if decryption fails, in case it's not actually encrypted
                try {
                    commandPayload = JSON.parse(Buffer.from(nexusAiParam, 'base64').toString('utf8'));
                    console.log("Payload interpreted as non-encrypted base64.");
                } catch (base64Error) {
                    return {
                        statusCode: 400,
                        body: JSON.stringify({ error: 'Decryption/Decoding Error', message: 'Could not decrypt or decode AI command payload. Invalid passphrase or data format.' }),
                    };
                }
            }
        } else {
            // If no passphrase set, assume base64 (unencrypted)
            try {
                commandPayload = JSON.parse(Buffer.from(nexusAiParam, 'base64').toString('utf8'));
                console.log("Payload interpreted as non-encrypted base64 (no passphrase set).");
            } catch (error) {
                return {
                    statusCode: 400,
                    body: JSON.stringify({ error: 'Decoding Error', message: 'Could not decode AI command payload. Malformed Base64 data.' }),
                };
            }
        }


        const { cmd: command, prm: parameters, context: clientContext } = commandPayload;
        if (!command) {
            return {
                statusCode: 400,
                body: JSON.stringify({ error: 'Bad Request', message: 'AI command (cmd) is missing from payload.' }),
            };
        }

        // Initialize Google Gemini Client
        const client = new GoogleGenerativeLanguageServiceClient({
            authClient: new GoogleGenerativeLanguageServiceClient().auth.fromAPIKey(GEMINI_API_KEY),
        });

        let geminiResponse;
        const model = 'gemini-pro'; // You can experiment with other models like 'gemini-pro-vision'

        // Build the prompt based on the command
        let promptText = "";
        const locationInfo = clientContext && clientContext.location && clientContext.location.latitude && clientContext.location.longitude ?
            ` User's approximate location: Latitude ${clientContext.location.latitude}, Longitude ${clientContext.location.longitude}.` : '';
        const deviceDetails = clientContext && clientContext.device ? ` Device: ${JSON.stringify(clientContext.device)}.` : '';
        const timestampInfo = clientContext && clientContext.timestamp ? ` Current time: ${clientContext.timestamp}.` : '';
        const localeInfo = clientContext && clientContext.locale ? ` User's locale: ${clientContext.locale}.` : '';


        switch (command) {
            case 'contextual-search':
                const searchText = parameters.intent || 'general query';
                const searchContext = parameters.context ? ` Context: ${parameters.context}.` : '';
                promptText = `Perform a smart search for: "${searchText}".${searchContext}${locationInfo}${deviceDetails}${timestampInfo}${localeInfo} Provide a concise, relevant answer or a list of search suggestions.`;
                break;

            case 'location-assistant':
                const locationIntent = parameters.intent || 'find places';
                let userLocationDetails = '';
                if (clientContext && clientContext.location && clientContext.location.latitude && clientContext.location.longitude) {
                    userLocationDetails = ` User is at Latitude: ${clientContext.location.latitude}, Longitude: ${clientContext.location.longitude}.`;
                } else if (clientContext && clientContext.location && clientContext.location.error) {
                    userLocationDetails = ` User location not available: ${clientContext.location.error}.`;
                } else {
                    userLocationDetails = ` User location unknown.`;
                }
                promptText = `Act as a helpful location assistant. Based on the intent "${locationIntent}" and ${userLocationDetails}${deviceDetails}${timestampInfo}${localeInfo} suggest relevant places, directions, or information.`;
                break;

            case 'product-info':
                const productId = parameters.productId;
                const productCategory = parameters.category || 'unknown';
                promptText = `Provide detailed information for product ID "${productId}" from the "${productCategory}" category.${locationInfo}${deviceDetails}${timestampInfo}${localeInfo} Focus on key features, specifications, and benefits.`;
                break;

            case 'customer-support':
                const supportTopic = parameters.topic || 'general inquiry';
                const userName = parameters.userName || 'Customer';
                promptText = `As a customer support AI, respond to ${userName}'s inquiry about "${supportTopic}".${locationInfo}${deviceDetails}${timestampInfo}${localeInfo} Provide clear, helpful guidance or direct them to relevant resources.`;
                break;

            default:
                return {
                    statusCode: 400,
                    body: JSON.stringify({ error: 'Bad Request', message: 'Unknown AI command.' }),
                };
        }

        geminiResponse = await client.generateContent({
            model,
            contents: [{ role: 'user', parts: [{ text: promptText }] }], // Using contents structure for consistency
        });

        // Extract content from Gemini's response structure
        const candidates = geminiResponse[0].candidates;
        const textResponse = candidates && candidates.length > 0 ? candidates[0].content.parts[0].text : 'No response from AI.';

        return {
            statusCode: 200,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                status: 'success',
                aiResponse: textResponse,
                // You can include more details from the raw Gemini response if needed
                // rawGeminiResponse: geminiResponse[0]
            }),
        };

    } catch (error) {
        console.error('Error in proxy-gemini function:', error);
        return {
            statusCode: 500,
            body: JSON.stringify({
                error: 'Internal Server Error',
                message: error.message,
                details: error.stack, // Include stack for debugging, remove in production
            }),
        };
    }
};
