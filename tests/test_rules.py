import math
import pytest
from pydantic import ValidationError
from backend.domain import Requirements, Evaluation, AppError, score_match

BLOCKS = [{'id': 'd1', 'text': 'Python development for 5 years.'}]


def evaluation(score=80, status='met', core=False):
    e = [{'text_block_id': 'd1', 'quote': 'Python development'}]
    return Evaluation.model_validate({'dimensions': [{'dimension': 'skills', 'score': score, 'reason': 'match', 'evidence': e if score is not None else []}],
        'conditions': [{'condition_id': 'c1', 'status': status, 'reason': 'judgment', 'evidence': e if status != 'unknown' else []}],
        'core_information_missing': core, 'summary': 'summary'})


REQ = Requirements(skills=['Python'], conditions=[{'id': 'c1', 'text': 'Python', 'kind': 'must'}])


@pytest.mark.parametrize('value,category,total', [(59.94, '不太匹配', 59.9), (59.95, '备选', 60), (60, '备选', 60), (79.94, '备选', 79.9), (79.95, '优先查看', 80), (80, '优先查看', 80), (100, '优先查看', 100), (0, '不太匹配', 0)])
def test_score_boundaries(value, category, total):
    result = score_match(REQ, evaluation(value), BLOCKS)
    assert (result['category'], result['total_score']) == (category, total)
    assert result['weights'] == {'skills': 1}


@pytest.mark.parametrize('score,status,core,category,provisional', [(99, 'not_met', True, '不太匹配', True), (99, 'unknown', False, '待补充信息', True), (99, 'met', True, '待补充信息', True), (None, 'met', False, '待补充信息', True), (80, 'met', False, '优先查看', False)])
def test_priority(score, status, core, category, provisional):
    result = score_match(REQ, evaluation(score, status, core), BLOCKS)
    assert (result['category'], result['provisional']) == (category, provisional)
    if score is None:
        assert result['total_score'] is None


def test_weight_normalization_without_conditions():
    req = Requirements(skills=['Python'], experience=['APIs'])
    e = evaluation(100)
    e.conditions = []
    e.dimensions.append(e.dimensions[0].model_copy(update={'dimension': 'experience', 'score': 0}))
    result = score_match(req, e, BLOCKS)
    assert result['total_score'] == 53.3
    assert result['weights']['skills'] == 40 / 75


@pytest.mark.parametrize('value', [float('nan'), float('inf'), -1, 101, '80', True])
def test_invalid_scores(value):
    with pytest.raises(ValidationError):
        evaluation(value)


@pytest.mark.parametrize('mutation', ['quote', 'block', 'missing_condition', 'duplicate_condition', 'missing_dimension', 'duplicate_dimension', 'no_evidence'])
def test_reject_invalid_contracts(mutation):
    e = evaluation()
    if mutation == 'quote': e.dimensions[0].evidence[0].quote = 'Kubernetes'
    if mutation == 'block': e.dimensions[0].evidence[0].text_block_id = 'invented'
    if mutation == 'missing_condition': e.conditions = []
    if mutation == 'duplicate_condition': e.conditions *= 2
    if mutation == 'missing_dimension': e.dimensions = []
    if mutation == 'duplicate_dimension': e.dimensions *= 2
    if mutation == 'no_evidence': e.conditions[0].evidence = []
    with pytest.raises(AppError):
        score_match(REQ, e, BLOCKS)


def test_empty_requirements_rejected():
    with pytest.raises(AppError, match='评分维度'):
        score_match(Requirements(), evaluation(), BLOCKS)


def test_whitespace_only_normalization():
    e = evaluation()
    e.dimensions[0].evidence[0].quote = 'Python\n development'
    assert score_match(REQ, e, BLOCKS)['category'] == '优先查看'


def test_bonus_only_and_all_weights():
    req = Requirements(skills=['Python'], experience=['API'], other=['qualification'], conditions=[{'id': 'c1', 'text': 'Python', 'kind': 'bonus'}])
    e = evaluation()
    e.dimensions = [e.dimensions[0].model_copy(update={'dimension': k, 'score': value}) for k, value in [('skills',100),('experience',80),('other',60),('bonus',50)]]
    result = score_match(req, e, BLOCKS)
    assert result['total_score'] == 82
    assert result['hard_counts'] == {'met':0,'not_met':0,'unknown':0}
