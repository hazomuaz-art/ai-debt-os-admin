-- §8: tracks which canned reply-variant ids have already been used in this
-- customer's conversation, so the anti-robotic/anti-repetition fallback
-- pools (now >=15 phrasings each) never repeat the same line twice in a row
-- within the same conversation.
alter table customers
  add column if not exists used_reply_variants jsonb not null default '{}'::jsonb;
