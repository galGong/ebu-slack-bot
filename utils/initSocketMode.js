// /utils/initSocketMode.js
import { WebClient } from '@slack/web-api';
import { SocketModeClient } from '@slack/socket-mode';
import { updateThreadTracking, getThreadTrackingByThreadId, getReleaseItems, createThreadTracking } from './airtable';
import { handleAssignDifferentPM } from './interactionHandlers';
import { sendInitialMessage, sendThreadMessage } from './slack';

const initSocketMode = () => {
  if (global.socketModeClient) {
    console.log('🔄 Reusing existing Socket Mode client');
    if (!global.socketModeClient.started) {
      console.log('🔌 Restarting existing Socket Mode client...');
      global.socketModeClient.start().catch(error => {
        console.error('❌ Failed to restart Socket Mode:', error);
      });
    }
    return { 
      slack: global.slackWebClient, 
      socketModeClient: global.socketModeClient 
    };
  }

  console.log('🆕 Creating new Socket Mode client');
  
  const slack = new WebClient(process.env.SLACK_BOT_TOKEN);
  console.log('📡 WebClient initialized');
  
  const socketModeClient = new SocketModeClient({
    appToken: process.env.SLACK_APP_TOKEN,
    logLevel: 'DEBUG',
    clientOptions: {
      // Add reconnection parameters
      reconnect: true,
      maxReconnectionAttempts: 10,
      reconnectionBackoff: 1000,
    }
  });
  console.log('🔗 SocketModeClient created');

  // Store in global object
  global.slackWebClient = slack;
  global.socketModeClient = socketModeClient;

  // Add connection event listeners
  socketModeClient.on('connecting', () => {
    console.log('🔄 Attempting to connect to Slack...');
  });

  socketModeClient.on('connected', () => {
    console.log('✅ Successfully connected to Slack');
  });

  socketModeClient.on('disconnected', () => {
    console.log('❌ Disconnected from Slack');
  });

  socketModeClient.on('error', (error) => {
    console.error('🚨 Socket Mode error:', error);
  });

  socketModeClient.on('interactive', async ({ body, ack }) => {
    console.log('📥 Interactive event received');
    console.log('📦 Event type:', body.type);
    console.log('🏷️ Action ID:', body.actions?.[0]?.action_id);
    console.log('📍 Channel:', body.channel?.id);
    console.log('🧵 Thread TS:', body.container?.thread_ts);
    
    try {
      await ack();
      console.log('✅ Event acknowledged');
      
      if (body.type === 'block_actions') {
        const action = body.actions[0];
        console.log('👉 Action received:', JSON.stringify(action, null, 2));
        
        switch (action.action_id) {
          case 'select_release': {
            const selectedReleaseId = action.selected_option.value;
            console.log('📎 Selected release ID:', selectedReleaseId);
            
            try {
              console.log('🔍 Looking for thread record with thread_ts:', body.container.thread_ts);
              const threadRecord = await getThreadTrackingByThreadId(body.container.thread_ts);
              console.log('✅ Found thread record:', JSON.stringify(threadRecord, null, 2));
              
              console.log('📝 Updating thread tracking...');
              const updatedRecord = await updateThreadTracking({
                recordId: threadRecord.id,
                status: 'matched',
                targetRecordId: selectedReleaseId,
                notes: ''
              });
              console.log('✅ Thread tracking updated successfully:', JSON.stringify(updatedRecord, null, 2));

              await slack.chat.postMessage({
                channel: body.channel.id,
                thread_ts: body.container.thread_ts,
                text: '✅ Release item has been successfully matched!'
              });
              console.log('✉️ Confirmation message sent to Slack');
            } catch (error) {
              console.error('❌ Error in select_release handler:', error);
              await slack.chat.postMessage({
                channel: body.channel.id,
                thread_ts: body.container.thread_ts,
                text: '❌ Failed to update release item matching. Please try again.'
              });
            }
            break;
          }
          case 'refresh_items': {
            console.log('🔄 Refresh items requested');
            try {
              // Get thread tracking record to get the PM name
              const threadRecord = await getThreadTrackingByThreadId(body.container.thread_ts);
              console.log('📝 Found thread record:', JSON.stringify(threadRecord, null, 2));
              
              const pmName = threadRecord.fields.PM_Name;
              console.log('👤 Using PM name from thread record:', pmName);
              
              // Get updated release items for the PM
              const releaseItems = await getReleaseItems(pmName);
              console.log('📋 Found release items:', releaseItems);
              
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
                channel: body.channel.id,
                ts: body.message.ts,
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
              console.log('✅ Message updated with refreshed items');
            } catch (error) {
              console.error('❌ Error refreshing items:', error);
              await slack.chat.postMessage({
                channel: body.channel.id,
                thread_ts: body.container.thread_ts,
                text: '❌ Failed to refresh items. Please try again.'
              });
            }
            break;
          }
          case 'assign_different_pm': {
            console.log('Assign to different PM requested');
            await handleAssignDifferentPM(
              slack,
              body.trigger_id,
              body.container.thread_ts,
              body.channel.id
            );
            break;
          }
        }
      }

      if (body.type === 'view_submission') {
        const { view } = body;
        
        if (view.callback_id === 'pm_reassign_modal') {
          const { thread_ts, channel_id } = JSON.parse(view.private_metadata);
          const selectedPm = view.state.values.pm_select.selected_pm.selected_user;
          
          try {
            // Get user info for the new PM first
            const userInfo = await slack.users.info({ user: selectedPm });
            const newPmName = userInfo.user.real_name;

            // Get the original thread tracking record
            const originalThread = await getThreadTrackingByThreadId(thread_ts);
            
            // Update original thread tracking record with the full name
            await updateThreadTracking({
              recordId: originalThread.id,
              status: 'Forward to a different PM',
              notes: `Forwarded to ${newPmName}`,
              targetRecordId: originalThread.fields.Target_Record_ID || ''
            });

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

            // Acknowledge the view submission
            await ack();
          } catch (error) {
            console.error('❌ Error handling PM reassignment:', error);
            try {
              await slack.chat.postMessage({
                channel: channel_id,
                thread_ts: thread_ts,
                text: '❌ Failed to reassign the request. Please try again.'
              });
            } catch (slackError) {
              console.error('❌ Failed to send error message:', slackError);
            }
            throw error;
          }
        }
      }
    } catch (error) {
      console.error('❌ Error in interactive handler:', error);
      try {
        await slack.chat.postMessage({
          channel: body.channel.id,
          thread_ts: body.container.thread_ts,
          text: '❌ An error occurred while processing your request. Please try again.'
        });
      } catch (slackError) {
        console.error('❌ Failed to send error message to Slack:', slackError);
      }
    }
  });

  // Start the client and log the result
  console.log('🚀 Starting Socket Mode client...');
  socketModeClient.start()
    .then(() => {
      console.log('✅ Socket Mode client started successfully');
    })
    .catch(error => {
      console.error('❌ Failed to start Socket Mode:', error);
    });

  return { slack, socketModeClient };
};

export default initSocketMode;