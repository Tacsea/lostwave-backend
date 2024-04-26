const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const Entry = require('./entry');
const fetch = require('node-fetch');

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors()); // Enable CORS for all routes
app.use(express.json());

uri = 'mongodb+srv://DevLW:Da3i8SFsv0nRRlOV@experiments.k6qzkyu.mongodb.net/leaderboard?retryWrites=true&w=majority&appName=Experiments'
localuri = 'mongodb://localhost:27017/leaderboard'
const apiKey = 'AIzaSyB39CSADY4D2jTrc3XWaAphbgpAmmTbxIw';

// Connect to MongoDB
mongoose.connect(localuri, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
});

const db = mongoose.connection;
db.on('error', console.error.bind(console, 'MongoDB connection error:'));
db.once('open', () => {
  console.log('Connected to MongoDB database');
  updateViews();
});

// *_*_*_*_*_*_*_*_*_*_*
// CALCULATING VIEWS SAGA
// *_*_*_*_*_*_*_*_*_*_*

// Function to fetch view counts for multiple YouTube videos using batch requests
const getYouTubeViews = async (videoIds) => {
  try {
      if (!videoIds || videoIds.length === 0) {
          console.warning("No video IDs provided.");
          return {};
      }

      const baseUrl = 'https://www.googleapis.com/youtube/v3/videos';

      // Split videoIds into batches to avoid hitting URL length limits
      const batchSize = 50; // Maximum number of video IDs per batch
      const batches = [];
      for (let i = 0; i < videoIds.length; i += batchSize) {
          batches.push(videoIds.slice(i, i + batchSize));
      }

      // Fetch view counts for each batch of video IDs
      const viewCounts = {};
      for (const batch of batches) {
          const batchViewCounts = await batchFetchViewCounts(batch, apiKey, baseUrl);
          Object.assign(viewCounts, batchViewCounts);
      }

      return viewCounts;
  } catch (error) {
      console.error(`Error fetching view counts for multiple videos: ${error}`);
      return {};
  }
};

// Function to make a single batch request to fetch view counts for multiple videos
const batchFetchViewCounts = async (videoIds, apiKey, baseUrl) => {
  try {
      // Construct parameters for the batch request
      const params = new URLSearchParams({
          key: apiKey,
          part: 'statistics',
          id: videoIds.join(',') // Concatenate video IDs separated by commas
      });

      // Make a single batch request to fetch view counts for multiple videos
      const response = await fetch(`${baseUrl}?${params.toString()}`);
      const data = await response.json();

      // Check if the response contains valid data
      if (data.items) {
          // Parse the response and extract view counts for each video
          const viewCounts = {};
          for (const item of data.items) {
              const videoId = item.id;
              const viewCount = parseInt(item.statistics.viewCount);
              viewCounts[videoId] = viewCount;
          }
          return viewCounts;
      } else {
          console.warning(`No data returned for video IDs: ${videoIds}`);
          return {};
      }
  } catch (error) {
      console.error(`Error fetching view counts: ${error}`);
      return {};
  }
};

// Function to calculate total views
const calculateTotalViews = async (entry) => {
  try {
      const mainYoutubeLink = entry.main_youtube_link;
      const additionalLinks = entry.additional_links || [];
      const mentionLinks = entry.mention_links || [];
      const coverageLinks = entry.coverage_links || [];
      const manualYt = entry.manual_yt || 0;
      const manualCoverage = entry.manual_coverage || 0;
      const manualMention = entry.manual_mention || 0;


      // Extract video IDs from YouTube video links
      const mainYoutubeId = mainYoutubeLink.split('v=')[1];
      const additionalIds = additionalLinks.map(link => link.split('v=')[1]);
      const mentionIds = mentionLinks.map(link => link.split('v=')[1]);
      const coverageIds = coverageLinks.map(link => link.split('v=')[1]);

      // Fetch view counts for main YouTube link and all additional links using batching
      const mainViews = await getYouTubeViews([mainYoutubeId]);
      const additionalViews = await getYouTubeViews(additionalIds);
      const mentionViews = await getYouTubeViews(mentionIds);
      const coverageViews = await getYouTubeViews(coverageIds);

      // Calculate total views including manual YT input
      const totalViews = Object.values(mainViews).reduce((acc, val) => acc + val, 0) +
          Object.values(additionalViews).reduce((acc, val) => acc + val, 0) + manualYt;
      const totalMentionViews = Object.values(mentionViews).reduce((acc, val) => acc + val, 0) + manualMention;
      const totalCoverageViews = Object.values(coverageViews).reduce((acc, val) => acc + val, 0) + manualCoverage;

      // Print the views for each link or if a link is not found
      for (const [link, views] of Object.entries(mainViews)) {
          console.log(`${link}: +${views} views`);
      }
      for (const [link, views] of Object.entries(additionalViews)) {
          console.log(`${link}: +${views} views`);
      }
      for (const [link, views] of Object.entries(mentionViews)) {
          console.log(`${link}: +${views} views`);
      }
      for (const [link, views] of Object.entries(coverageViews)) {
          console.log(`${link}: +${views} views`);
      }

      return { totalViews, totalMentionViews, totalCoverageViews };
    } catch (error) {
        console.error(`Error calculating total views: ${error}`);
        return { totalViews: 0, totalMentionViews: 0, totalCoverageViews: 0 };
    }
};

const updateDailyViews = (entry, periodViews, count) => {
  if (count > 12) {
      entry.daily_views = periodViews;
      count = 1
  } else {
      const currentDaily = entry.daily_views || 0;
      entry.daily_views = currentDaily + periodViews;
  }
};

const updateWeeklyViews = (entry, periodViews) => {
  const currentDate = new Date();
  if (currentDate.getDay() === 1) { // If it's Monday, reset weekly views
      entry.weekly_views = periodViews;
  } else {
      entry.weekly_views += periodViews;
  }
};

const updateMonthlyViews = (entry, periodViews) => {
  const currentDate = new Date();
  if (currentDate.getDate() === 1) { // If it's the first day of the month, reset monthly views
      entry.monthly_views = periodViews;
  } else {
      entry.monthly_views += periodViews
  }
};


// *_*_*_*_*_*_*_*_*_*_*
// DELETED LINKS AND VIEWS SAGA
// *_*_*_*_*_*_*_*_*_*_*

const updateDeletedLinksAndManualViews = async (entry, lastDailyViews, todaysCoverage, todaysMentions) => {
  try {
      // Revert daily views if they were negative due to deleted links
      let revertedDailyViews = periodViews >= 0 ? entry.daily_views : lastDailyViews;

      let deletedAdditionalLinks = [];
      let deletedMentionLinks = [];
      let deletedCoverageLinks = [];
      let manualYtAdditional = entry.manual_yt || 0;
      let manualCoverage = entry.manual_coverage || 0;
      let manualMention = entry.manual_mention || 0;

      // Call catchDeletedLinks if any of the daily/today variables is a negative number
      if (dailyViews < 0) {
          const allAdditionalLinks = (entry.additional_links || []).concat(entry.main_youtube_link);
          const result = catchDeletedLinks(allAdditionalLinks);
          deletedAdditionalLinks = result.deletedLinks;
          manualYtAdditional += Math.abs(dailyViews);
      }
      if (todaysCoverage < 0) {
          const result = catchDeletedLinks(entry.coverage_links || []);
          deletedCoverageLinks = result.deletedLinks;
          manualCoverage += Math.abs(todaysCoverage);
      }
      if (todaysMentions < 0) {
          const result = catchDeletedLinks(entry.mention_links || []);
          deletedMentionLinks = result.deletedLinks;
          manualMention += Math.abs(todaysMentions);
      }

      // Push the found deleted links into the entry's general deleted_links array
      const deletedLinks = [
          ...new Set([...deletedAdditionalLinks, ...deletedMentionLinks, ...deletedCoverageLinks])
      ];

      // Retrieve the existing links for the selected array
      const existingLinks = entry.deleted_links || [];

      // Extract new links from the link_list and remove duplicates
      const newLinks = deletedLinks.filter(link => !existingLinks.includes(link.trim()));

      // Append new links to the selected array in the database
      if (newLinks.length > 0) {
          await Entry.updateOne(
              { _id: entry._id },
              { $addToSet: { deleted_links: { $each: newLinks } } }
          );
      }

      // Add the manual views to the respective manual counts
      await Entry.updateOne(
          { _id: entry._id },
          {
              $set: {
                  manual_yt: manualYtAdditional,
                  manual_mention: manualMention,
                  manual_coverage: manualCoverage
              }
          }
      );

      console.log('Updated deleted links and manual views.');
  } catch (error) {
      console.error('Error updating deleted links and manual views:', error);
  }
};

// Function to check if a link is deleted by attempting to fetch views
const isItDeleted = async (link) => {
  try {
      if (!link) {
          console.warning('No video link provided.');
          return true;
      }

      const api_key = 'YOUR_API_KEY'; // Provide your YouTube API key
      const base_url = 'https://www.googleapis.com/youtube/v3/videos';

      // Extract video ID from the link
      const video_id = link.split('=')[1];

      // Construct parameters for the request
      const params = {
          key: api_key,
          part: 'statistics',
          id: video_id
      };

      // Make the API call to fetch video data
      const response = await fetch(`${base_url}?${new URLSearchParams(params)}`);
      const data = await response.json();

      // Check if the response contains valid data
      if (data.items && data.items.length > 0) {
          // Video exists, return false (not deleted)
          console.info(`Video with ID ${video_id} is not deleted.`);
          return false;
      } else {
          // Video does not exist or no data returned, consider as deleted
          console.info(`Video with ID ${video_id} is deleted.`);
          return true;
      }
  } catch (error) {
      console.error('Error checking if link is deleted:', error);
      return true; // Assume link is deleted if an error occurs
  }
};

// Function to catch deleted links in an array of links
const catchDeletedLinks = async (links) => {
  try {
      const deletedLinks = [];
      for (const link of links) {
          // Check if the link is deleted
          if (await isItDeleted(link)) {
              deletedLinks.push(link);
          }
      }
      return { deletedLinks };
  } catch (error) {
      console.error('Error catching deleted links:', error);
      return { deletedLinks: [] };
  }
};

// *_*_*_*_*_*_*_*_*

// Main function to update views every 2 hours
const updateViews = async () => {
  let updatesCount = 0;
  while (true) {
      try {
          const entries = await Entry.find(); // Fetch entries from the database
          for (const entry of entries) {
              // Step 1: Grab last total, mention, and coverage views
              const lastTotalViews = entry.total_views || 0;
              const lastMentionViews = entry.mention_views || 0;
              const lastCoverageViews = entry.coverage_views || 0;
              const lastDailyViews = entry.daily_views || 0;

              // Step 2: period views
              const { totalViews } = await calculateTotalViews(entry);
              const periodViews = totalViews - lastTotalViews;
              const todaysCoverage = totalCoverageViews - lastCoverageViews
              const todaysMention = totalMentionViews - lastMentionViews

              // Step 3: Catch deleted links
              updateDeletedLinksAndManualViews(entry, periodViews, lastDailyViews, todaysCoverage, todaysMention)

              // Step 4: Update timed views
              updateDailyViews(entry, periodViews);
              updateWeeklyViews(entry, periodViews);
              updateMonthlyViews(entry, periodViews);

              // Step 5: Update entry with total, mention, and coverage views
              entry.total_views = totalViews;
              entry.mention_views = mentionViews;
              entry.coverage_views = coverageViews;

              // Save updated entry back to the database
              await entry.save();
              updatesCount++;
          }

          // Check if the day has ended
          const currentDate = new Date();
          if (currentDate.getHours() === 0) {
              // Reset daily views to 0 at midnight
              for (const entry of entries) {
                  entry.daily_views = 0;
              }
              updatesCount = 0; // Reset the counter at midnight
          }
      } catch (error) {
          console.error('Error updating views:', error);
      }

      // Sleep for 2 hours
      await new Promise(resolve => setTimeout(resolve, 2 * 60 * 60 * 1000));
  }
};

// Define routes
app.get('/entries', async (req, res) => {
  try {
    const entries = await Entry.find();

    if (entries.length === 0) {
      return res.status(404).json({ error: 'No entries found' });
    }

    res.json(entries);
  } catch (error) {
    console.error('Error fetching entries:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Start the server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
