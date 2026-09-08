"""Validated model contracts and deterministic, evidence-backed scoring."""
import re
from decimal import Decimal, ROUND_HALF_UP
from typing import Literal
from pydantic import BaseModel, ConfigDict, Field, model_validator
from .rubrics import PROFILES, profile_view

DIMENSIONS = {'skills': 40, 'experience': 35, 'other': 15, 'bonus': 10}
PROMPT_VERSION = '2'
SCORING_VERSION = '2'
PARSER_VERSION = '1'


class AppError(Exception):
    def __init__(self, code, message, status=400, retryable=False):
        self.code, self.message, self.status, self.retryable = code, message, status, retryable
        super().__init__(message)


class StrictModel(BaseModel):
    model_config = ConfigDict(extra='forbid', str_strip_whitespace=True)


class Condition(StrictModel):
    id: str = Field(min_length=1, max_length=80)
    text: str = Field(min_length=1, max_length=1000)
    kind: Literal['must', 'bonus']


class Requirements(StrictModel):
    scoring_profile: Literal['generic', 'toc', 'internal_ai'] = 'generic'
    skills: list[str] = Field(default_factory=list, max_length=50)
    experience: list[str] = Field(default_factory=list, max_length=50)
    other: list[str] = Field(default_factory=list, max_length=50)
    conditions: list[Condition] = Field(default_factory=list, max_length=50)

    @model_validator(mode='after')
    def check_items(self):
        ids = [c.id for c in self.conditions]
        if len(set(ids)) != len(ids):
            raise ValueError('条件编号不能重复')
        for key in ('skills', 'experience', 'other'):
            if any(not s.strip() or len(s) > 1000 for s in getattr(self, key)):
                raise ValueError('岗位要求不能为空或超过 1000 字')
        return self

    def active(self):
        if self.scoring_profile != 'generic':
            return list(self.weights())
        return [k for k in DIMENSIONS if (any(c.kind == 'bonus' for c in self.conditions) if k == 'bonus' else bool(getattr(self, k)))]

    def weights(self):
        return {key: weight for key, _, weight in PROFILES[self.scoring_profile]['criteria']}


class Evidence(StrictModel):
    text_block_id: str
    quote: str = Field(min_length=1, max_length=4000)


class Dimension(StrictModel):
    dimension: Literal['skills', 'experience', 'other', 'bonus', 'growth_results', 'toc_strategy', 'data_experiments', 'cross_team', 'ownership', 'ai_practice', 'workflow_roi', 'product_delivery', 'evaluation_risk', 'ai_ownership']
    score: float | None = Field(ge=0, le=100, allow_inf_nan=False, strict=True)
    reason: str = Field(min_length=1, max_length=2000)
    evidence: list[Evidence] = Field(max_length=30)


class Judgment(StrictModel):
    condition_id: str
    status: Literal['met', 'not_met', 'unknown']
    reason: str = Field(min_length=1, max_length=2000)
    evidence: list[Evidence] = Field(max_length=30)


class Review(StrictModel):
    claimed_ai_depth: str = Field(min_length=1, max_length=1000)
    verification_confidence: Literal['高', '中', '低']
    ownership_level: Literal['高', '中', '低', '未知']
    strengths: list[str] = Field(max_length=15)
    risks: list[str] = Field(max_length=15)
    unknowns: list[str] = Field(max_length=15)
    must_verify: list[str] = Field(max_length=15)
    final_recommendation: str = Field(min_length=1, max_length=2000)

    @model_validator(mode='after')
    def review_language(self):
        if '简历自述' not in self.claimed_ai_depth:
            raise ValueError('AI 深度必须注明简历自述')
        if '建议 HR' not in self.final_recommendation or not any(s in self.final_recommendation for s in ('人工复核', '面试核验')):
            raise ValueError('建议必须说明由 HR 人工核验')
        if any(s in self.final_recommendation for s in ('录用', '淘汰', '拒绝候选人')):
            raise ValueError('不得输出自动决策结论')
        for group in (self.strengths, self.risks, self.unknowns, self.must_verify):
            if any(not s.strip() or len(s) > 2000 for s in group):
                raise ValueError('复核条目不能为空或超过 2000 字')
        return self


class Evaluation(StrictModel):
    dimensions: list[Dimension] = Field(max_length=5)
    conditions: list[Judgment] = Field(max_length=50)
    core_information_missing: bool = Field(strict=True)
    summary: str = Field(min_length=1, max_length=2000)
    review: Review | None = None


class ResumeFact(StrictModel):
    text: str = Field(min_length=1, max_length=2000)
    evidence: list[Evidence] = Field(min_length=1, max_length=15)


class ParsedResume(StrictModel):
    name: str = Field(max_length=100)
    skills: list[ResumeFact] = Field(max_length=100)
    experience: list[ResumeFact] = Field(max_length=100)
    education: list[ResumeFact] = Field(max_length=50)
    projects: list[ResumeFact] = Field(max_length=100)


def normalized(text):
    return re.sub(r'\s+', '', text)


def validate_evidence(refs, blocks):
    indexed = {b['id']: normalized(b['text']) for b in blocks}
    for ref in refs:
        quote = normalized(ref.quote)
        if not quote or quote not in indexed.get(ref.text_block_id, ''):
            raise AppError('invalid_evidence', '模型引用无法在简历原文中找到，请重试。', retryable=True)


def validate_resume(parsed, blocks):
    if parsed.name and normalized(parsed.name) not in normalized(' '.join(b['text'] for b in blocks)):
        raise AppError('invalid_evidence', '模型返回的姓名无法在原文中核对。', retryable=True)
    for group in ('skills', 'experience', 'education', 'projects'):
        for fact in getattr(parsed, group):
            validate_evidence(fact.evidence, blocks)
    return parsed


def score_match(requirements, evaluation, blocks):
    active = requirements.active()
    weights = requirements.weights()
    specialized = requirements.scoring_profile != 'generic'
    if specialized and evaluation.review is None:
        raise AppError('invalid_output', '专用评分必须包含人工复核、个人贡献和 AI 实践核验信息。', retryable=True)
    if not active:
        raise AppError('empty_requirements', '请至少填写一个评分维度的岗位要求。')
    keys = [d.dimension for d in evaluation.dimensions]
    ids = [c.condition_id for c in evaluation.conditions]
    if len(keys) != len(set(keys)) or set(keys) != set(active):
        raise AppError('invalid_output', '模型遗漏或重复了适用评分维度。', retryable=True)
    if len(ids) != len(set(ids)) or set(ids) != {c.id for c in requirements.conditions}:
        raise AppError('invalid_output', '模型遗漏或重复了条件编号。', retryable=True)
    for entry in [*evaluation.dimensions, *evaluation.conditions]:
        validate_evidence(entry.evidence, blocks)
        needs_evidence = entry.score is not None if isinstance(entry, Dimension) else entry.status != 'unknown'
        if needs_evidence and not entry.evidence:
            raise AppError('invalid_evidence', '确定性判断必须附有原文依据；未提供信息应标记待确认。', retryable=True)
    mandatory = {c.id for c in requirements.conditions if c.kind == 'must'}
    hard = [c for c in evaluation.conditions if c.condition_id in mandatory]
    incomplete = evaluation.core_information_missing or any(c.status == 'unknown' for c in hard) or any(d.score is None for d in evaluation.dimensions)
    total = None
    if all(d.score is not None for d in evaluation.dimensions):
        value = sum(Decimal(str(d.score)) * weights[d.dimension] for d in evaluation.dimensions) / sum(weights[k] for k in active)
        total = float(value.quantize(Decimal('0.1'), rounding=ROUND_HALF_UP))
    if any(c.status == 'not_met' for c in hard):
        category = '低优先复核' if specialized else '不太匹配'
    elif incomplete:
        category = '待补充信息'
    else:
        category = ('高优先复核' if total >= 80 else '中优先复核' if total >= 60 else '低优先复核') if specialized else ('优先查看' if total >= 80 else '备选' if total >= 60 else '不太匹配')
    return {**evaluation.model_dump(), 'total_score': total, 'category': category, 'provisional': incomplete,
            'scoring_profile': profile_view(requirements.scoring_profile),
            'weights': {k: weights[k] / sum(weights[a] for a in active) for k in active},
            'hard_counts': {s: sum(c.status == s for c in hard) for s in ('met', 'not_met', 'unknown')}}
