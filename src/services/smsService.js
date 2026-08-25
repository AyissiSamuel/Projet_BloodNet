// services/smsService.js
const { TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_PHONE_NUMBER } = process.env;

let client = null;

function getTwilioClient() {
  if (client) return client;

  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN) {
    console.warn('Twilio non configuré: TWILIO_ACCOUNT_SID ou TWILIO_AUTH_TOKEN manquant.');
    return null;
  }

  // Initialisation paresseuse : accountSid en premier, authToken en second
  client = require('twilio')(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);
  return client;
}

const sendSMS = async (to, message) => {
  try {
    const c = getTwilioClient();
    if (!c) {
      // Choix : no-op et log, ou throw si l'envoi est impératif
      console.info('SMS non envoyé (Twilio non configuré).', { to, message });
      return { success: false, error: 'Twilio not configured' };
    }

    const response = await c.messages.create({
      body: message,
      from: TWILIO_PHONE_NUMBER,
      to,
    });

    console.log('SMS envoyé avec succès, ID :', response.sid);
    return { success: true, sid: response.sid };
  } catch (error) {
    console.error("Erreur lors de l'envoi du SMS :", error);
    return { success: false, error: error && error.message ? error.message : String(error) };
  }
};

module.exports = { sendSMS };
