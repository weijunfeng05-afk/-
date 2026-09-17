-- 010: 支持删除岗位与候选人
-- 背景：简历属于敏感个人信息，内测必须提供删除入口。
-- 问题：原外键未声明级联，删除岗位会被候选人/评分卡阻塞。
-- 说明：应用层也按顺序显式删除下级数据，本迁移作为数据库层的一致性保障。

alter table public.candidates drop constraint if exists candidates_job_id_fkey;
alter table public.candidates add constraint candidates_job_id_fkey
  foreign key (job_id) references public.jobs(id) on delete cascade;

alter table public.evaluations drop constraint if exists evaluations_candidate_id_fkey;
alter table public.evaluations add constraint evaluations_candidate_id_fkey
  foreign key (candidate_id) references public.candidates(id) on delete cascade;

alter table public.scorecards drop constraint if exists scorecards_job_id_fkey;
alter table public.scorecards add constraint scorecards_job_id_fkey
  foreign key (job_id) references public.jobs(id) on delete cascade;

alter table public.ranking_reviews drop constraint if exists ranking_reviews_job_id_fkey;
alter table public.ranking_reviews add constraint ranking_reviews_job_id_fkey
  foreign key (job_id) references public.jobs(id) on delete cascade;
