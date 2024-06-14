const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const Entry = require('./entry');
const fetch = require('node-fetch-commonjs');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');

const app = express();
const PORT = process.env.PORT || 5000;

const NodeCache = require('node-cache');
const publicCache = new NodeCache();
const backendCache = new NodeCache();

require('dotenv').config();

// Middleware
app.use(cors()); // Enable CORS for all routes
app.use(express.json());

const uri = process.env.DB_URL;
localuri = 'mongodb://localhost:27017/leaderboard'
const apiKey = process.env.YT_APIKEY;

// Connect to MongoDB
mongoose.connect(uri, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
});

const db = mongoose.connection;
db.on('error', console.error.bind(console, 'MongoDB connection error:'));
db.once('open', () => {
  console.log('Connected to MongoDB database');
  console.log('Database:', db.name);
  updateViews();
});


// *_*_*_*_*_*_*_*_*_*_*
// CALCULATING VIEWS SAGA
// *_*_*_*_*_*_*_*_*_*_*

// Function to fetch view counts for multiple YouTube videos using batch requests
const getYouTubeViews = async (videoIds) => {
  try {
      if (!videoIds || videoIds.length === 0) {
          console.warn("No video IDs provided.");
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


const MAX_RETRY_ATTEMPTS = 3;
const RETRY_DELAY_MS = 1000;

// Function to make a single batch request to fetch view counts for multiple videos
const batchFetchViewCounts = async (videoIds, apiKey, baseUrl) => {
  let retryAttempts = 0;
  while (retryAttempts < MAX_RETRY_ATTEMPTS) {
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
            console.warn(`No data returned for video IDs: ${videoIds}`);
            return {};
        }
      } catch (error) {
        console.error(`Error fetching view counts (attempt ${retryAttempts + 1}): ${error}`);
        retryAttempts++;
        await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS * retryAttempts)); // Exponential backoff
    }
  }
  console.error(`Failed to fetch view counts after ${MAX_RETRY_ATTEMPTS} attempts.`);
  return {};
};

// Function to calculate total views
const calculateTotalViews = async (entry) => {
  try {
      const name = entry.name
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
      console.log({name})
      for (const [link, views] of Object.entries(mainViews)) {
          'console.log(`${link}: +${views} main views`);'
      }
      for (const [link, views] of Object.entries(additionalViews)) {
          'console.log(`${link}: +${views} additional views`);'
      }
      for (const [link, views] of Object.entries(mentionViews)) {
          'console.log(`${link}: +${views} mention views`);'
      }
      for (const [link, views] of Object.entries(coverageViews)) {
          'console.log(`${link}: +${views} coverage views`);'
      }
      console.log(`totalViews: ${totalViews}, mentionViews: ${totalMentionViews}, coverageViews: ${totalCoverageViews}`);
      return { totalViews, totalMentionViews, totalCoverageViews };
    } catch (error) {
        console.error(`Error calculating total views: ${error}`);
        return { totalViews: 0, totalMentionViews: 0, totalCoverageViews: 0 };
    }
};

const updateDailyViews = (entry, periodViews, updatedCount) => {
  console.log(`${entry.name}: currently ${entry.daily_views} daily views`);
  if (updatedCount === 1) {
      entry.daily_views = periodViews;
  } else {
      const currentDaily = isNaN(entry.daily_views) ? 0 : entry.daily_views;
      entry.daily_views = currentDaily + periodViews;
  }
  console.log(`${entry.name}: updated to ${entry.daily_views} daily views after adding +${periodViews}`);
};

const updateWeeklyViews = (entry, periodViews) => {
  const currentDate = new Date();
  if (currentDate.getDay() === 1) { // If it's Monday, reset weekly views
      entry.weekly_views = entry.daily_views;
  } else {
      entry.weekly_views = isNaN(entry.weekly_views) ? 0 : entry.weekly_views + periodViews;
  }
};

const updateMonthlyViews = (entry, periodViews) => {
  const currentDate = new Date();
  if (currentDate.getDate() === 1) { // If it's the first day of the month, reset monthly views
      entry.monthly_views = entry.daily_views;
  } else {
      entry.monthly_views = isNaN(entry.monthly_views) ? 0 : entry.monthly_views + periodViews;
  }
};


// *_*_*_*_*_*_*_*_*_*_*
// DELETED LINKS AND VIEWS SAGA
// *_*_*_*_*_*_*_*_*_*_*

const updateDeletedLinksAndManualViews = async (entry, periodViews, lastDailyViews, todaysCoverage, todaysMentions) => {
    try {
  
        let deletedAdditionalLinks = [];
        let deletedMentionLinks = [];
        let deletedCoverageLinks = [];
        let manualYtAdditional = entry.manual_yt || 0;
        let manualCoverage = entry.manual_coverage || 0;
        let manualMention = entry.manual_mention || 0;
  
        // Check if additional_links is defined and not null
        if (entry.additional_links && Array.isArray(entry.additional_links)) {
            // Call catchDeletedLinks if any of the daily/today variables is a negative number
            if (periodViews < 0) {
                console.log('Additional links found, calling catchDeletedLinks...');
                const result = await catchDeletedLinks(entry.additional_links);
                deletedAdditionalLinks = result.deletedLinks;
                manualYtAdditional += Math.abs(periodViews);
            }
        } else {
            console.log('Additional links not found or not an array:', entry.additional_links);
        }
  
        // Check if mention_links is defined and not null
        if (entry.mention_links && Array.isArray(entry.mention_links)) {
            // Call catchDeletedLinks if any of the daily/today variables is a negative number
            if (todaysMentions < 0) {
                console.log('Mention links found, calling catchDeletedLinks...');
                const result = await catchDeletedLinks(entry.mention_links);
                deletedMentionLinks = result.deletedLinks;
                manualMention += Math.abs(todaysMentions);
            }
        } else {
            console.log('Mention links not found or not an array:', entry.mention_links);
        }
  
        // Check if coverage_links is defined and not null
        if (entry.coverage_links && Array.isArray(entry.coverage_links)) {
            // Call catchDeletedLinks if any of the daily/today variables is a negative number
            if (todaysCoverage < 0) {
                console.log('Coverage links found, calling catchDeletedLinks...');
                const result = await catchDeletedLinks(entry.coverage_links);
                deletedCoverageLinks = result.deletedLinks;
                manualCoverage += Math.abs(todaysCoverage);
            }
        } else {
            console.log('Coverage links not found or not an array:', entry.coverage_links);
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
          console.warn('No video link provided.');
          return true;
      }

      const api_key = apiKey
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

const updateViews = async () => {
  let updatedCount = 0;

  try {
      while (true) {
          const entries = await Entry.find(); // Fetch entries from the database
          
          for (const entry of entries) {
              try {
                // Step 1: Grab last total, mention, and coverage views
                const lastTotalViews = entry.total_views || 0;
                const lastDailyViews = entry.daily_views || 0;
                let lastWeeklyViews = entry.weekly_views || 0;
                let lastMonthlyViews = entry.monthly_views || 0; 

                // Step 2: Calculate total views
                const { totalViews } = await calculateTotalViews(entry);
                console.log(`${entry.name}: has ${lastTotalViews} total views before this calculation`);

                const periodViews = totalViews - lastTotalViews;
                console.log(`${entry.name}: found ${periodViews} period views`);

                // Step 3: Catch deleted main views
                if (periodViews < 0) {
                  await updateDeletedLinksAndManualViews(entry, periodViews, lastDailyViews, 0, 0);
                  // Revert daily views if they were negative due to deleted links
                  let revertedDailyViews = periodViews >= 0 ? entry.daily_views : lastDailyViews;
                  entry.daily_views = revertedDailyViews;
                  entry.weekly_views = lastWeeklyViews;
                  entry.monthly_views = lastMonthlyViews;
                }

                if (updatedCount === 1) {
                  // Only calculate mention and coverage views if updatedCount is 1
                  const { totalMentionViews, totalCoverageViews } = await calculateTotalViews(entry);
                  const lastMentionViews = entry.mention_views || 0;
                  const lastCoverageViews = entry.coverage_views || 0;

                  console.log(`${entry.name}: has ${lastMentionViews} mention views before this calculation`);
                  console.log(`${entry.name}: has ${lastCoverageViews} coverage views before this calculation`);

                  const todaysCoverage = totalCoverageViews - lastCoverageViews;
                  console.log(`${entry.name}: found ${todaysCoverage} today coverage views`);

                  const todaysMention = totalMentionViews - lastMentionViews;
                  console.log(`${entry.name}: found ${todaysMention} today mention views`);

                  // Catch deleted links for mention and coverage views
                  if (todaysMention < 0 || todaysCoverage < 0) {
                    await updateDeletedLinksAndManualViews(entry, periodViews, lastDailyViews, todaysCoverage, todaysMention);
                  }

                  // Update mention and coverage views in the entry
                  entry.mention_views = totalMentionViews;
                  entry.coverage_views = totalCoverageViews;
                }

                // Update timed views
                await updateDailyViews(entry, periodViews, updatedCount);
                await updateWeeklyViews(entry, periodViews);
                await updateMonthlyViews(entry, periodViews);

                // Update total views in the entry
                entry.total_views = totalViews;

                // Save updated entry back to the database
                await entry.save();

              } catch (error) {
                  console.error('Error updating views for an entry:', error);
              }
          }

          updatedCount++;
          console.log('Updates today:', updatedCount);

          // Check if 12 updates have been done
          if (updatedCount >= 12) {
              updatedCount = 1
          }
  
          // Sleep for 2 hours
          await new Promise(resolve => setTimeout(resolve, 2 * 60 * 60 * 1000));
      }
  } catch (error) {
      console.error('Error fetching entries from the database:', error);
  }
};

const TTL_IN_SECONDS = 750

const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (token == null) return res.sendStatus(401); // Unauthorized

  jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, (err, user) => {
    if (err) return res.sendStatus(403); // Forbidden
    req.user = user;
    next();
  });
};

const expectedUsername = process.env.DB_USERNAME;
const hashedPassword = process.env.HASHED_PASSWORD;

app.post('/login', (req, res) => {
  const { username, password } = req.body;

/*   console.log('Received username:', username);
  console.log('Received password:', password); */
  
  // Check if the provided username matches the configured username
/*   console.log('Expected username (from environment variable):', expectedUsername); */
  if (username !== expectedUsername) {
    console.log('Invalid username:', username);
    return res.status(401).json({ error: 'Invalid username' });
  }

  // Compare the provided password with the hashed password
  bcrypt.compare(password, hashedPassword, (err, result) => {
    if (err || !result) {
      return res.status(401).json({ error: 'Invalid password' });
    }
    
    // Generate JWT token
    const token = jwt.sign({ username: username }, process.env.ACCESS_TOKEN_SECRET);

    // Send token in response
    res.json({ token: token }); 
  });
});

app.get('/entries', authenticateToken, async (req, res) => {
  try {
    let entries = backendCache.get('entries');
    if (!entries) {
      entries = await Entry.find();
      backendCache.set('entries', entries, TTL_IN_SECONDS);
    }
    
    res.json(entries);
  } catch (error) {
    console.error('Error fetching entries:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

  // Function to calculate displayed views based on filters
function calculateDisplayedViews(entry, filters) {
    let displayedViews = entry.total_views;
  
    if (filters.includeCoverageValue) {
      displayedViews += entry.coverage_views;
    }
  
    if (filters.includeMentionsValue) {
      displayedViews += entry.mention_views;
    }
  
    if (filters.includeOtherSitesValue) {
      displayedViews += entry.manual_other;
    }
  
    if (filters.includeDailyViewsValue || filters.includeWeeklyViewsValue || filters.includeMonthlyViewsValue) {
      displayedViews = 0; // Reset displayedViews
  
      if (filters.includeDailyViewsValue) {
        displayedViews += entry.daily_views;
      }
  
      if (filters.includeWeeklyViewsValue) {
        displayedViews += entry.weekly_views;
      }
  
      if (filters.includeMonthlyViewsValue) {
        displayedViews += entry.monthly_views;
      }
    }
  
    return displayedViews;
  }

const rateLimitWindowMs = 60000; // 1 minute
const maxRequestsPerWindow = 10;
const requestQueue = [];

function rateLimit(req, res, next) {
  const now = Date.now();
  while (requestQueue.length > 0 && requestQueue[0] < now - rateLimitWindowMs) {
    requestQueue.shift();
  }

  if (requestQueue.length >= maxRequestsPerWindow) {
    return res.status(429).json({ error: 'Rate limit exceeded' });
  }

  requestQueue.push(now);
  next();
}

app.get('/api', rateLimit, async (req, res) => {
  try {
    let entries = backendCache.get('entries');
    if (!entries) {
      entries = await Entry.find();
      backendCache.set('entries', entries, TTL_IN_SECONDS);
    }

    if (req.query.olw === 'true') {
      entries = entries.filter(entry => entry.as_seen_lw === 'SEEN' || entry.as_seen_lw === 'UNSEEN');
    } else {
      entries = entries.filter(entry => entry.as_seen_lw === 'SEEN');
    }

    if (req.query.f) {
      entries = entries.filter(entry => entry.status !== 'LOST');
    }

    if (req.query.l) {
      entries = entries.filter(entry => entry.status !== 'FOUND');
    }

    if (!req.query.h) {
      entries = entries.filter(entry => !entry.is_hide);
    }

    if (req.query.hx) {
      entries = entries.filter(entry => entry.is_hoax !== 'TRUE');
    }

    if (req.query.sortBy === 'asc_views') {
      entries.sort((a, b) => calculateDisplayedViews(b, req.query) - calculateDisplayedViews(a, req.query));
    }

    if (req.query.sortBy === 'desc_views') {
      entries.sort((a, b) => calculateDisplayedViews(a, req.query) - calculateDisplayedViews(b, req.query));
    }

    const publicProjection = {
      name: 1,
      description: 1,
      main_youtube_link: 1,
      total_views: 1,
      mention_views: 1,
      coverage_views: 1,
      daily_views: 1,
      weekly_views: 1,
      monthly_views: 1,
      manual_other: 1,
      as_seen_lw: 1,
      choice: 1,
      is_hoax: 1,
      country_of_origin: 1,
      generation: 1,
      language: 1
    };

    // Applying projection to exclude private fields
    entries = entries.map(entry => {
      const publicEntry = {};
      Object.keys(publicProjection).forEach(key => {
        if (entry[key] !== undefined) {
          publicEntry[key] = entry[key];
        }
      });
      return publicEntry;
    });

    res.json(entries);
  } catch (error) {
    console.error('Error fetching entries:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Export the function
module.exports = {
    calculateTotalViews,
    updateDailyViews,
    updateWeeklyViews,
    updateMonthlyViews,
    updateDeletedLinksAndManualViews,
    isItDeleted, 
    catchDeletedLinks,
    publicCache,
    backendCache,
};

process.on('exit', () => {
  console.log('Clearing public cache...');
  publicCache.flushAll();
  console.log('Clearing backend cache...');
  backendCache.flushAll();
  console.log('Exiting process...');
});

process.on('SIGINT', () => {
  console.log('Received SIGINT. Shutting down...');
  console.log('Clearing public cache...');
  publicCache.flushAll();
  console.log('Clearing backend cache...');
  backendCache.flushAll();
  console.log('Exiting process...');
  process.exit(0);
});

const server = app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});

server.on('close', () => {
  console.log('Clearing public cache...');
  publicCache.flushAll();
  console.log('Clearing backend cache...');
  backendCache.flushAll();
  console.log('Server closed.');
});

