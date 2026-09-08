"""Role rubrics migrated from the user's resume-data/screening.py."""
PROFILES = {
    'generic': {'name': '通用岗位匹配', 'criteria': [
        ('skills', '技能匹配', 40), ('experience', '经历相关性', 35),
        ('other', '其他岗位要求', 15), ('bonus', '额外加分条件', 10)]},
    'toc': {'name': 'ToC 商业化产品运营', 'criteria': [
        ('growth_results', '用户增长、留存、转化及商业化结果', 30),
        ('toc_strategy', 'ToC 产品/运营策略与落地', 25),
        ('data_experiments', '数据分析、实验和指标意识', 20),
        ('cross_team', '跨团队协作与项目推进', 15),
        ('ownership', '结果 ownership 与复盘能力', 10)]},
    'internal_ai': {'name': '内部提效 AI 产品经理', 'criteria': [
        ('ai_practice', 'AI/大模型产品理解与真实实践', 30),
        ('workflow_roi', '内部工作流洞察、提效场景与 ROI', 25),
        ('product_delivery', '产品定义、原型、迭代和落地', 20),
        ('evaluation_risk', '数据、评测、风险与人机协同意识', 15),
        ('ai_ownership', '跨团队推动与 ownership', 10)]},
}


def profile_view(key):
    profile = PROFILES[key]
    return {'id': key, 'name': profile['name'], 'criteria': [
        {'id': i, 'label': label, 'weight': weight} for i, label, weight in profile['criteria']]}
