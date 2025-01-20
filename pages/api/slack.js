// /pages/api/slack.js
import { sendInitialMessage, sendThreadMessage } from '../../utils/slack';
import { getReleaseItems, createThreadTracking } from '../../utils/airtable';

// /pages/api/slack.js
export default async function handler(req, res) {
  console.log('🚀 Received webhook:', {
    method: req.method,
    body: req.body,
    headers: req.headers
  });

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Parse the nested JSON string from Zapier
    let parsedBody;
    try {
      if (req.body['']) {
        parsedBody = JSON.parse(req.body['']);
      } else {
        parsedBody = req.body;
      }
    } catch (error) {
      console.error('Error parsing body:', error, req.body);
      return res.status(400).json({ error: 'Invalid JSON body' });
    }

    console.log('Parsed body:', parsedBody);

    const { type, pmId, sfdc_record_id, pm_name, request_name } = parsedBody;

    // Validate required fields
    if (!type || !pmId || !sfdc_record_id || !pm_name || !request_name) {
      console.error('Missing required fields:', parsedBody);
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Send initial message
    let initialMessage;
    try {
      initialMessage = await sendInitialMessage(pmId, pm_name, request_name, sfdc_record_id);
    } catch (error) {
      console.error('Error sending initial message:', error);
      return res.status(500).json({ error: 'Failed to send Slack message' });
    }

    // Get release items for the PM
    let releaseItems;
    try {
      releaseItems = await getReleaseItems(pm_name);
    } catch (error) {
      console.error('Error getting release items:', error);
      releaseItems = []; // Use empty array if fetch fails
    }

    // Send threaded message with interactive components
    let threadMessage;
    try {
      threadMessage = await sendThreadMessage(pmId, initialMessage.ts, releaseItems);
    } catch (error) {
      console.error('Error sending thread message:', error);
      return res.status(500).json({ error: 'Failed to send thread message' });
    }

    // Create thread tracking record
    try {
      await createThreadTracking({
        threadId: initialMessage.ts,
        sfdcRecordId: sfdc_record_id,
        channel: pmId,
        pmName: pm_name
      });
    } catch (error) {
      console.error('Error creating thread tracking:', error);
      // Continue even if tracking creation fails
    }

    return res.status(200).json({
      success: true,
      initialMessage,
      threadMessage
    });

  } catch (error) {
    console.error('Error processing webhook:', error);
    return res.status(500).json({
      error: 'Internal server error',
      details: error.message
    });
  }
}