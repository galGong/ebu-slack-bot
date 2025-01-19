// /utils/slack.js
import { WebClient } from '@slack/web-api';

const slack = new WebClient(process.env.SLACK_BOT_TOKEN);

export const sendInitialMessage = async (pmId, pmName, requestName, sfdcRecordId) => {
    try {
      const message = await slack.chat.postMessage({
        channel: pmId,
        text: `Hey @${pmName} Gong has committed to this new EBU sfdc request ${requestName}`, // Adding text field explicitly
        blocks: [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: `Hey @${pmName} Gong has committed to this new EBU sfdc request ${requestName}`
            }
          },
          {
            type: "actions",
            elements: [
              {
                type: "button",
                text: {
                  type: "plain_text",
                  text: "View Record",
                  emoji: true
                },
                url: `https://airtable.com/${process.env.AIRTABLE_BASE_ID}/tbl${process.env.THREAD_TRACKING_TABLE_ID}/${sfdcRecordId}`
              }
            ]
          }
        ]
      });
      return message;
    } catch (error) {
      console.error('Error sending Slack message:', error, { pmId, pmName, requestName });
      throw error;
    }
  };

  export const sendThreadMessage = async (channel, threadTs, releaseItems) => {
    try {
      // Ensure we have at least one option
      const options = releaseItems?.length > 0 ? releaseItems : [{
        id: 'new_item',
        feature: '+ Create New Item'
      }];
  
      const message = await slack.chat.postMessage({
        channel: channel,
        thread_ts: threadTs,
        text: "Please do the following actions:\n1. Find the correlated release item in your airtable release tracker\n2. If you can't find the proper item please add a new item to the table\n3. In this dropdown please choose the item",
        blocks: [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: "Please do the following actions:\n1. Find the correlated release item in your airtable release tracker\n2. If you can't find the proper item please add a new item to the table\n3. In this dropdown please choose the item"
            }
          },
          {
            type: "actions",
            block_id: "release_actions",
            elements: [
              {
                type: "static_select",
                action_id: "select_release",
                placeholder: {
                  type: "plain_text",
                  text: "Select a release item",
                  emoji: true
                },
                options: options.map(item => ({
                  text: {
                    type: "plain_text",
                    text: String(item.feature).substring(0, 75), // Slack has a 75-char limit
                    emoji: true
                  },
                  value: String(item.id)
                }))
              },
              {
                type: "button",
                action_id: "refresh_items",
                text: {
                  type: "plain_text",
                  text: "🔄 Refresh Items",
                  emoji: true
                }
              },
              {
                type: "button",
                action_id: "assign_different_pm",
                text: {
                  type: "plain_text",
                  text: "👤 Assign to Different PM",
                  emoji: true
                }
              }
            ]
          }
        ]
      });
      return message;
    } catch (error) {
      console.error('Error sending thread message:', error);
      // If the error is related to invalid blocks, send a simpler message
      if (error.code === 'slack_webapi_platform_error') {
        const fallbackMessage = await slack.chat.postMessage({
          channel: channel,
          thread_ts: threadTs,
          text: "⚠️ Unable to load release items. Please try refreshing or contact support if the issue persists."
        });
        return fallbackMessage;
      }
      throw error;
    }
  };