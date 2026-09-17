-- 011 自助注册：把「必须持有邮箱专属邀请码」改为「邀请码可选」。
--
-- 背景：002_beta.sql 的 beta_registration 触发器要求 auth.users 插入时必须携带
-- 有效且未使用的邀请码，否则整个注册事务失败。内测阶段希望同事自己填邮箱注册，
-- 因此这里把校验改为：未提交邀请码 → 直接放行（自助注册）；
-- 提交了邀请码 → 仍严格校验，无效则拒绝。邀请码能力保留，需要收紧时随时可恢复。
--
-- 同时为新注册用户初始化内测额度记录，避免首次调用额度函数时才补建。

create or replace function enforce_beta_invite() returns trigger
language plpgsql security definer set search_path=public as $$
declare invite_code text := nullif(trim(coalesce(new.raw_user_meta_data->>'beta_invite','')), '');
begin
  if invite_code is null then
    return new;
  end if;
  -- 变量名不能叫 code，否则与 beta_invites.code 列名冲突（column reference "code" is ambiguous）。
  update beta_invites set used=true, used_by=new.id
   where beta_invites.code=invite_code and lower(beta_invites.email)=lower(new.email) and not used and expires_at>now();
  if not found then
    raise exception '邀请码无效、已被使用、已过期或与邮箱不匹配';
  end if;
  return new;
end $$;

revoke all on function enforce_beta_invite() from public;

-- 新用户注册后立即建立额度行，默认额度沿用 beta_usage 表定义。
create or replace function init_beta_usage() returns trigger
language plpgsql security definer set search_path=public as $$
begin
  insert into beta_usage(owner) values(new.id) on conflict do nothing;
  return new;
end $$;

revoke all on function init_beta_usage() from public;

drop trigger if exists beta_usage_init on auth.users;
create trigger beta_usage_init after insert on auth.users
for each row execute function init_beta_usage();
