const express = require('express');
const axios = require('axios');
const app = express();

app.use(express.json());

// Required CORS Middleware for Web3 Agent Console
app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, payment-signature, X-Payment-Receipt, payment-request');
    res.setHeader('Access-Control-Expose-Headers', 'PAYMENT-REQUIRED, PAYMENT-RESPONSE, payment-request');
    
    if (req.method === 'OPTIONS') {
        return res.sendStatus(200);
    }
    next();
});

const PORT = process.env.PORT || 10000;
const MY_BASE_WALLET = process.env.MY_BASE_WALLET || "0x452993071FdE3743767f98f339E90D9A313BBf3B";
const API_AMOUNT_PER_CALL = process.env.API_AMOUNT_PER_CALL || "1000";
const BASE_NETWORK_ID = "8453";
const FACILITATOR_URL = "https://x402.org";

const buildPaymentRequirements = (baseUrl, routePath) => ({
    scheme: "exact",
    network: `eip155:${BASE_NETWORK_ID}`,
    amount: API_AMOUNT_PER_CALL,
    asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bda02913",
    payTo: MY_BASE_WALLET,
    maxTimeoutSeconds: 30,
    extra: {
        name: "USD Coin",
        version: "2",
        assetTransferMethod: "eip3009",
        domain: {
            name: "USD Coin",
            version: "2",
            chainId: parseInt(BASE_NETWORK_ID),
            verifyingContract: "0x833589fCD6eDb6E08f4c7C32D4f71b54bda02913"
        }
    }
});

const generate402Offer = (baseUrl, routePath) => ({
    x402Version: 2,
    error: "Payment required",
    resource: { 
        url: `${baseUrl}${routePath}`,
        description: "Low-cost high-speed gateway health probe for real x402 settlement validation checks.",
        mimeType: "application/json"
    },
    accepts: [buildPaymentRequirements(baseUrl, routePath)],
    extensions: {
        bazaar: {
            info: {
                input: {
                    type: "http",
                    method: "GET",
                    queryParams: { ping: "test" }
                },
                output: {
                    type: "json",
                    example: {
                        status: "success",
                        message: "Gateway operational. Protocol check verified.",
                        latency_ms: 1,
                        timestamp: 1714856000
                    }
                }
            },
            schema: {
                $schema: "https://json-schema.org",
                type: "object",
                properties: {
                    input: { type: "object" },
                    output: { type: "object" }
                },
                required: ["input", "output"]
            }
        }
    }
});

// Shared handler with full x402 v2 verify + on-chain settle + PAYMENT-RESPONSE header
const handleHealthProbe = async (req, res, routePath) => {
    const startTime = Date.now();
    const paymentSignature = req.headers['payment-signature'];
    const hostUrl = `${req.protocol}://${req.get('host')}`;
    const paymentRequirements = buildPaymentRequirements(hostUrl, routePath);
    const offerPayload = generate402Offer(hostUrl, routePath);

    if (!paymentSignature) {
        const base64Offer = Buffer.from(JSON.stringify(offerPayload)).toString('base64');
        res.setHeader('PAYMENT-REQUIRED', base64Offer);
        return res.status(402).json(offerPayload);
    }

    let paymentPayload;
    try {
        const decodedJson = Buffer.from(paymentSignature, 'base64').toString('utf8');
        paymentPayload = JSON.parse(decodedJson);
    } catch (e) {
        return res.status(400).json({ error: "Malformed base64 payment-signature header." });
    }

    try {
        // 1. Verify payment signature with facilitator
        const verifyRes = await axios.post(`${FACILITATOR_URL}/verify`, {
            x402Version: 2,
            paymentPayload,
            paymentRequirements
        });

        if (!verifyRes.data || !verifyRes.data.isValid) {
            return res.status(402).json({
                error: "Payment verification failed",
                reason: verifyRes.data?.invalidReason || "Invalid signature"
            });
        }

        // 2. Settle payment on-chain on Base Mainnet
        const settleRes = await axios.post(`${FACILITATOR_URL}/settle`, {
            x402Version: 2,
            paymentPayload,
            paymentRequirements
        });

        if (!settleRes.data || !settleRes.data.success) {
            return res.status(402).json({
                error: "Payment settlement failed",
                reason: settleRes.data?.errorReason || "Settlement rejected"
            });
        }

        // 3. Attach Base64-encoded PAYMENT-RESPONSE header so vAPI confirms settlement
        const base64Receipt = Buffer.from(JSON.stringify(settleRes.data)).toString('base64');
        res.setHeader('PAYMENT-RESPONSE', base64Receipt);

    } catch (err) {
        const details = err.response?.data || err.message;
        return res.status(402).json({ error: "Facilitator verification/settlement error", details });
    }

    res.status(200).json({
        status: "success",
        message: "Gateway operational. Protocol check verified.",
        network: "Base Mainnet (8453)",
        latency_ms: Date.now() - startTime,
        timestamp: Date.now()
    });
};

// Free Path for Cron-Job.org
app.get('/keepawake', (req, res) => {
    res.status(200).json({ status: "warm", message: "Keep-awake monitor loop successful." });
});

// Both endpoints verify, settle on-chain, and return live diagnostic metrics
app.get('/openapi.json', (req, res) => handleHealthProbe(req, res, '/openapi.json'));
app.get('/', (req, res) => handleHealthProbe(req, res, '/'));

app.listen(PORT, '0.0.0.0', () => {
    console.log(`Apex Health Probe active on port ${PORT}`);
});
