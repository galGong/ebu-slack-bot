// /utils/airtable.js
import Airtable from 'airtable';

const base = new Airtable({ apiKey: process.env.AIRTABLE_API_KEY }).base(process.env.AIRTABLE_BASE_ID);

export const getReleaseItems = async (pmName) => {
  try {
    console.log('🔍 Starting getReleaseItems with PM name:', pmName);
    
    const formula = `SEARCH("${pmName}", {PM owner})`;
    console.log('🔬 Using filter formula:', formula);
    
    const records = await base(process.env.RELEASE_TRACKER_TABLE_ID)
      .select({
        view: process.env.RELEASE_TRACKER_VIEW_ID,
        filterByFormula: formula
      })
      .all();
    
    console.log('🔢 Found records count:', records.length);
    
    if (records.length === 0) {
      console.log('⚠️ No records found, returning default new item option');
      return [{
        id: 'new_item',
        feature: '+ Create New Item'
      }];
    }
    
    const mappedRecords = records.map(record => ({
      id: record.id,
      feature: record.get('Feature ') || 'Untitled Feature'
    }));
    
    console.log('✨ Mapped records:', mappedRecords);
    return mappedRecords;
  } catch (error) {
    console.error('❌ Error in getReleaseItems:', error);
    return [{
      id: 'new_item',
      feature: '+ Create New Item'
    }];
  }
};

export const createThreadTracking = async (threadData) => {
  try {
    console.log('Creating thread tracking record:', threadData);
    
    const records = await base(process.env.THREAD_TRACKING_TABLE_ID).create([
      {
        fields: {
          'Thread_ID': threadData.threadId,
          'Source_Record_ID': threadData.sfdcRecordId,
          'Channel_ID': threadData.channel,
          'PM_Name': threadData.pmName,
          'Status': threadData.status || 'waiting',
          'Notes': threadData.notes || '',
          'Target_Record_ID': threadData.targetRecordId || ''
        }
      }
    ]);

    return records[0];
  } catch (error) {
    console.error('Error creating thread tracking:', error);
    return null;
  }
};

export const updateThreadTracking = async ({
  recordId,
  status,
  notes = '',
  targetRecordId = ''
}) => {
  try {
    const records = await base(process.env.THREAD_TRACKING_TABLE_ID).update([
      {
        id: recordId,
        fields: {
          'Status': status,
          'Notes': notes,
          'Target_Record_ID': targetRecordId
        }
      }
    ]);
    return records[0];
  } catch (error) {
    console.error('Error updating thread tracking:', error);
    throw error;
  }
};

export const getThreadTrackingByThreadId = async (threadId) => {
  try {
    const records = await base(process.env.THREAD_TRACKING_TABLE_ID)
      .select({
        filterByFormula: `{Thread_ID} = '${threadId}'`
      })
      .firstPage();
    
    if (records.length === 0) {
      throw new Error('Thread tracking record not found');
    }
    
    return records[0];
  } catch (error) {
    console.error('Error getting thread tracking:', error);
    throw error;
  }
};