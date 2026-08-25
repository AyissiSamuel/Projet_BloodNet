// services/smsService.js
const twilio = require('twilio');

const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const client = twilio(accountSid, authToken);

const sendSMS = async (to, message) => {
    try {
        const response = await client.messages.create({
            body: message,
            from: process.env.TWILIO_PHONE_NUMBER, // Votre numéro Twilio
            to: to // Doit être vérifié sur Twilio en mode gratuit (ex: +2376XXXXXXXX)
        });
        console.log('SMS envoyé avec succès, ID :', response.sid);
        return { success: true, sid: response.sid };
    } catch (error) {
        console.error('Erreur lors de l\'envoi du SMS :', error);
        return { success: false, error: error.message };
    }
};

module.exports = { sendSMS };