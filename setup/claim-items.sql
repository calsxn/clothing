-- Run this AFTER seed-items.sql (and after your 'cal' account exists).
-- 1) Hands ownership of all imported items to your account
update public.items
set user_id = (select user_id from public.profiles where username = 'cal')
where user_id is null;

-- 2) Removes the temporary account that was used to test the site
delete from auth.users where email = 'testbot@clothes-tracker.local';
