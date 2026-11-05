-- Rollback of 0019: removes delete_my_account and restores members.user_id as required + cascading.
-- Refuses while any member row has no login (a deleted account), because those rows cannot satisfy NOT NULL.
begin;
do $$ begin
  if exists (select 1 from members where user_id is null) then
    raise exception 'Cannot roll back: some members belong to deleted accounts (user_id is empty)';
  end if;
end $$;
drop function if exists delete_my_account();
create or replace function prevent_role_privilege_escalation()
returns trigger
language plpgsql
security definer
as $$
begin
  if new.role is distinct from old.role then
    if new.role = 'superadmin' then
      if exists (
        select 1 from members where family_id = old.family_id and role = 'superadmin'
      ) then
        raise exception 'this family already has a superadmin';
      end if;
    elsif old.role = 'superadmin' then
      raise exception 'superadmin role cannot be changed once set';
    else
      if not is_admin(old.family_id) then
        raise exception 'only an admin can change a member''s role';
      end if;
    end if;
  end if;
  return new;
end;
$$;

alter table members drop constraint if exists members_user_id_fkey;
alter table members add constraint members_user_id_fkey
  foreign key (user_id) references auth.users(id) on delete cascade;
alter table members alter column user_id set not null;
commit;
