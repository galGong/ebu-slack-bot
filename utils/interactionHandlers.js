import { getThreadTrackingByThreadId, updateThreadTracking } from './airtable';

export async function handleAssignDifferentPM(slackClient, trigger_id, thread_ts, channel_id) {
  try {
    return await slackClient.views.open({
      trigger_id,
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
          thread_ts,
          channel_id
        })
      }
    });
  } catch (error) {
    console.error('Error opening modal:', error);
    throw error;
  }
} 