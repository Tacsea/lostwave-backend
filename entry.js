// entry.js

const mongoose = require('mongoose');

const entrySchema = new mongoose.Schema({
    name: String,
    description: String,
    main_youtube_link: String,
    additional_links: [String],
    coverage_links: [String],
    mention_links: [String],
    manual_yt: Number,
    manual_other: Number,
    status: String,
    thumbnail_link: String,
    total_views: Number,
    mention_views: Number,
    coverage_views: Number,
    daily_views: Number,
    weekly_views: Number,
    monthly_views: Number,
    last_updated: Date,
    manual_mention: Number,
    manual_coverage: Number,
    deleted_links: [String],
    as_seen_lw: String,
    choice: String,
    is_hoax: String,
    country_of_origin: String,
    generation: String,
});

const Entry = mongoose.model('Entry', entrySchema);

module.exports = Entry;