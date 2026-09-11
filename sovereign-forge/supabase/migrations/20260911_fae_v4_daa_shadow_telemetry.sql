-- FAE public-testnet Difficulty + Timestamp continuous shadow telemetry.
-- Observer-only: no trigger, no mutation of block acceptance, no consensus authority.

create or replace function public.fae_shadow_pow2_nonnegative(exp integer)
returns numeric language plpgsql immutable strict as $$
declare i integer; value numeric := 1;
begin
  if exp < 0 or exp > 256 then raise exception 'shadow_pow2_exponent_out_of_range'; end if;
  if exp = 0 then return 1; end if;
  for i in 1..exp loop value := value * 2; end loop;
  return value;
end; $$;

create or replace function public.fae_shadow_target_from_bits(bits integer)
returns numeric language plpgsql immutable strict as $$
begin
  if bits < 0 or bits > 255 then raise exception 'shadow_bits_out_of_range'; end if;
  return public.fae_shadow_pow2_nonnegative(256-bits)-1;
end; $$;

create or replace function public.fae_shadow_hex256(input_value numeric)
returns text language plpgsql immutable strict as $$
declare value numeric := trunc(input_value); out_hex text := ''; digit integer; i integer;
begin
  if input_value <> trunc(input_value) or value < 0 or value >= public.fae_shadow_pow2_nonnegative(256) then raise exception 'shadow_hex256_out_of_range'; end if;
  for i in 1..64 loop
    digit := mod(value,16)::integer;
    out_hex := substr('0123456789abcdef',digit+1,1) || out_hex;
    value := trunc(value/16);
  end loop;
  if value <> 0 then raise exception 'shadow_hex256_overflow'; end if;
  return out_hex;
end; $$;

create or replace function public.fae_shadow_asert_target(anchor_target numeric, anchor_height bigint, anchor_parent_time_seconds bigint, evaluation_height bigint, evaluation_time_seconds bigint, target_seconds integer default 180, half_life_seconds integer default 21600, pow_limit numeric default null)
returns numeric language plpgsql immutable strict as $$
declare
  radix numeric := 65536;
  limit_target numeric := coalesce(pow_limit,public.fae_shadow_target_from_bits(12));
  time_delta numeric; height_delta numeric; exponent0 numeric; num_shifts integer; exponent numeric; factor numeric; next_target numeric;
begin
  if anchor_height < 1 or evaluation_height < anchor_height then raise exception 'shadow_evaluation_before_anchor'; end if;
  if target_seconds <= 0 or half_life_seconds <= 0 then raise exception 'shadow_invalid_timing_parameter'; end if;
  if anchor_target <= 0 or anchor_target > limit_target then raise exception 'shadow_invalid_anchor_target'; end if;
  time_delta := evaluation_time_seconds-anchor_parent_time_seconds;
  height_delta := evaluation_height-anchor_height;
  exponent0 := trunc(((time_delta-target_seconds*(height_delta+1))*radix)/half_life_seconds);
  num_shifts := floor(exponent0/radix)::integer;
  exponent := exponent0-num_shifts*radix;
  factor := floor((195766423245049::numeric*exponent + 971821376::numeric*exponent*exponent + 5127::numeric*exponent*exponent*exponent + public.fae_shadow_pow2_nonnegative(47))/public.fae_shadow_pow2_nonnegative(48))+radix;
  if num_shifts > 255 then return limit_target; end if;
  if num_shifts < -255 then return 1; end if;
  next_target := anchor_target*factor;
  if num_shifts < 0 then next_target := floor(next_target/public.fae_shadow_pow2_nonnegative(-num_shifts)); else next_target := next_target*public.fae_shadow_pow2_nonnegative(num_shifts); end if;
  next_target := floor(next_target/radix);
  if next_target <= 0 then return 1; end if;
  if next_target > limit_target then return limit_target; end if;
  return next_target;
end; $$;

create or replace view public.fae_v4_daa_shadow_config as
select 'observer-only-not-consensus'::text as status, 410::bigint as anchor_height, anchor.hash::text as anchor_hash, anchor.difficulty_bits::integer as anchor_difficulty_bits,
  public.fae_shadow_target_from_bits(anchor.difficulty_bits)::numeric as anchor_target,
  floor(parent.timestamp_ms/1000.0)::bigint as anchor_parent_time_seconds,
  180::integer as target_seconds, 21600::integer as half_life_seconds, 11::integer as mtp_window, 90000::bigint as future_drift_ms
from public.fae_v4_blocks anchor join public.fae_v4_blocks parent on parent.height=anchor.height-1 where anchor.height=410;

create or replace view public.fae_v4_daa_shadow_telemetry as
with config as (select * from public.fae_v4_daa_shadow_config), observed as (
  select b.height::bigint observed_height,b.hash::text observed_hash,b.previous_hash::text,b.timestamp_ms::bigint,b.created_at,
    floor(extract(epoch from b.created_at)*1000)::bigint arrival_time_ms,b.difficulty_bits::integer current_difficulty_bits,
    parent.timestamp_ms::bigint parent_timestamp_ms,mtp.mtp_ms::bigint,
    c.*,public.fae_shadow_target_from_bits(b.difficulty_bits) current_target,
    public.fae_shadow_asert_target(c.anchor_target,c.anchor_height,c.anchor_parent_time_seconds,b.height,floor(b.timestamp_ms/1000.0)::bigint,c.target_seconds,c.half_life_seconds,public.fae_shadow_target_from_bits(12)) candidate_next_target
  from public.fae_v4_blocks b cross join config c
  left join public.fae_v4_blocks parent on parent.height=b.height-1
  left join lateral (select percentile_disc(0.5) within group(order by recent.timestamp_ms)::bigint mtp_ms from (select p.timestamp_ms from public.fae_v4_blocks p where p.height<b.height order by p.height desc limit 11) recent) mtp on true
  where b.height>=c.anchor_height
), classified as (
  select *,case when parent_timestamp_ms is not null and timestamp_ms<parent_timestamp_ms then 'timestamp_before_parent' when mtp_ms is not null and timestamp_ms<=mtp_ms then 'timestamp_not_above_mtp' when timestamp_ms>arrival_time_ms+future_drift_ms then 'timestamp_too_far_future' else null end timestamp_error from observed
)
select status,observed_height,observed_hash,observed_height+1 candidate_next_height,previous_hash,timestamp_ms,created_at,arrival_time_ms,arrival_time_ms-timestamp_ms arrival_lag_ms,parent_timestamp_ms,mtp_ms,
  timestamp_error is null candidate_timestamp_ok,timestamp_error,current_difficulty_bits,
  public.fae_shadow_hex256(current_target) current_target_hex,public.fae_shadow_hex256(candidate_next_target) candidate_next_target_hex,
  trunc(((candidate_next_target-current_target)*1000000)/current_target)::bigint candidate_vs_current_delta_ppm,
  floor(public.fae_shadow_pow2_nonnegative(256)/(candidate_next_target+1))::numeric candidate_next_work,
  anchor_height,anchor_hash,anchor_difficulty_bits,public.fae_shadow_hex256(anchor_target) anchor_target_hex,anchor_parent_time_seconds,target_seconds,half_life_seconds,mtp_window,future_drift_ms
from classified;

create or replace view public.fae_v4_daa_shadow_health as
select 'observer-only-not-consensus'::text status,count(*)::bigint observed_rows,min(observed_height)::bigint first_observed_height,max(observed_height)::bigint latest_observed_height,
  count(*) filter(where not candidate_timestamp_ok)::bigint timestamp_rule_failures,max(abs(candidate_vs_current_delta_ppm))::bigint max_abs_target_delta_ppm,
  (array_agg(candidate_vs_current_delta_ppm order by observed_height desc))[1]::bigint latest_target_delta_ppm,
  (array_agg(candidate_next_target_hex order by observed_height desc))[1]::text latest_candidate_next_target_hex,
  (array_agg(anchor_height order by observed_height desc))[1]::bigint anchor_height,(array_agg(anchor_hash order by observed_height desc))[1]::text anchor_hash
from public.fae_v4_daa_shadow_telemetry;

comment on view public.fae_v4_daa_shadow_telemetry is 'Observer-only FAE v4 ASERT/MTP shadow telemetry. Never consensus-authoritative.';
comment on view public.fae_v4_daa_shadow_health is 'Observer-only health summary for FAE Difficulty + Timestamp shadow telemetry.';
grant select on public.fae_v4_daa_shadow_config to anon, authenticated;
grant select on public.fae_v4_daa_shadow_telemetry to anon, authenticated;
grant select on public.fae_v4_daa_shadow_health to anon, authenticated;
