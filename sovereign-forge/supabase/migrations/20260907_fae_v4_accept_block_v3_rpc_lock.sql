-- Live hardening discovered by the Supabase security advisor after the
-- activation-gated v3 RPC was deployed. PostgreSQL grants EXECUTE to PUBLIC
-- on new functions by default, and Supabase's anon/authenticated roles must be
-- explicitly denied. Only service_role may call the SECURITY DEFINER RPC.

revoke all on function public.fae_v4_accept_block_v3(bigint,text,text,bigint,integer,bigint,text,numeric,numeric,jsonb,text,jsonb,jsonb) from public;
revoke all on function public.fae_v4_accept_block_v3(bigint,text,text,bigint,integer,bigint,text,numeric,numeric,jsonb,text,jsonb,jsonb) from anon;
revoke all on function public.fae_v4_accept_block_v3(bigint,text,text,bigint,integer,bigint,text,numeric,numeric,jsonb,text,jsonb,jsonb) from authenticated;
grant execute on function public.fae_v4_accept_block_v3(bigint,text,text,bigint,integer,bigint,text,numeric,numeric,jsonb,text,jsonb,jsonb) to service_role;
