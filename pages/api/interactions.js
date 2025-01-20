// /pages/api/interactions.js
import { slack, sendInitialMessage, sendThreadMessage } from '../../utils/slack';
import { getReleaseItems, updateThreadTracking, createThreadTracking, getThreadTrackingByThreadId } from '../../utils/airtable';
import { handleAssignDifferentPM } from '../../utils/interactionHandlers';

export default async function handler(req, res) {
  // Handle Slack URL verification challenge
  if (req.body.type === 'url_verification') {
    return res.status(200).json({ challenge: req.body.challenge });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Check if payload exists and parse it
    const payload = req.body.payload || req.body;
    const interaction = typeof payload === 'string' ? JSON.parse(payload) : payload;
    
    console.log('Received interaction:', interaction);

    const { type, actions, user, container, channel } = interaction;

    if (type === 'block_actions') {
      const action = actions[0];
      console.log('Processing action:', action.action_id);

      switch (action.action_id) {
        case 'select_release': {
          const selectedReleaseId = action.selected_option.value;
          
          // Get thread tracking record using thread_ts
          const threadRecord = await getThreadTrackingByThreadId(container.thread_ts);
          
          // Update thread tracking with release item ID and status
          await updateThreadTracking({
            recordId: threadRecord.id,
            status: 'matched',
            targetRecordId: selectedReleaseId,
            notes: ''
          });

          await slack.chat.postMessage({
            channel: channel.id,
            thread_ts: container.thread_ts,
            text: '✅ Release item has been successfully matched!'
          });
          break;
        }

        case 'refresh_items': {
          try {
            // Get user's full name from Slack
            const userInfo = await slack.users.info({ user: user.id });
            const pmName = userInfo.user.real_name;
            
            // Get updated release items for the PM using full name
            const releaseItems = await getReleaseItems(pmName);
            
            // Create options for the select menu
            const options = releaseItems.map(item => ({
              text: { 
                type: 'plain_text',
                text: String(item.feature).substring(0, 75),
                emoji: true
              },
              value: String(item.id)
            }));

            // Update the select menu with new options
            await slack.chat.update({
              channel: channel.id,
              ts: container.message_ts,
              blocks: [
                {
                  type: "section",
                  text: {
                    type: "mrkdwn",
                    text: "Please select a release item:"
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
                      options: options
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
          } catch (error) {
            console.error('Error refreshing items:', error);
            return res.status(500).json({ error: 'Internal server error' });
          }
          break;
        }

        case 'assign_different_pm': {
          await slack.views.open({
            trigger_id: interaction.trigger_id,
            view: {
              type: 'modal',
              callback_id: 'pm_reassign_modal',
              title: {
                type: 'plain_text',
                text: 'Assign to Different PM'
              },
              blocks: [
                {
                  type: 'input',
                  block_id: 'pm_select',
                  label: {
                    type: 'plain_text',
                    text: 'Select PM to reassign the EBU feature request'
                  },
                  element: {
                    type: 'users_select',
                    action_id: 'selected_pm'
                  }
                }
              ],
              submit: {
                type: 'plain_text',
                text: 'Assign'
              },
              private_metadata: JSON.stringify({
                thread_ts: container.thread_ts,
                channel_id: channel.id
              })
            }
          });
          break;
        }
      }
    }

    if (type === 'view_submission') {
      const { view } = interaction;
      
      if (view.callback_id === 'pm_reassign_modal') {
        const { thread_ts, channel_id } = JSON.parse(view.private_metadata);
        const selectedPm = view.state.values.pm_select.selected_pm.selected_user;
        
        // Get the original thread tracking record
        const originalThread = await getThreadTrackingByThreadId(thread_ts);
        
        // Update original thread tracking record
        await updateThreadTracking({
          recordId: originalThread.id,
          status: 'Forward to a different PM',
          notes: `Forwarded to ${selectedPm}`,
          targetRecordId: originalThread.fields.Target_Record_ID || ''
        });

        // Get user info for the new PM
        const userInfo = await slack.users.info({ user: selectedPm });
        const newPmName = userInfo.user.real_name;

        // Create new initial message for the new PM
        const newInitialMessage = await sendInitialMessage(
          selectedPm, 
          newPmName,
          originalThread.fields.Request_Name,
          originalThread.fields.Source_Record_ID
        );

        // Get release items for the new PM
        const releaseItems = await getReleaseItems(newPmName);

        // Send thread message to the new PM
        await sendThreadMessage(selectedPm, newInitialMessage.ts, releaseItems);

        // Create new thread tracking record for the new PM
        await createThreadTracking({
          threadId: newInitialMessage.ts,
          sfdcRecordId: originalThread.fields.Source_Record_ID,
          channel: selectedPm,
          pmName: newPmName,
          status: 'waiting'
        });

        // Notify in the original thread
        await slack.chat.postMessage({
          channel: channel_id,
          thread_ts: thread_ts,
          text: `✅ This request has been reassigned to <@${selectedPm}>`
        });
      }
    }

    return res.status(200).json({ ok: true });
  } catch (error) {
    console.error('Error handling interaction:', error, {
      body: req.body,
      payload: req.body.payload
    });
    return res.status(500).json({
      error: 'Internal server error',
      details: error.message
    });
  }
}