-- Appends an explicit installment-ban instruction to the STC portfolio's
-- company_playbooks.ai_instructions. STC's playbook already had
-- installments.allowed = false (set in 030_stc_policy_no_legal.sql), but
-- carried no written instruction telling the agent never to PROPOSE
-- installments on its own — the only enforcement was the generic
-- NEGOTIATION prompt template in ai-collector-agent.ts, which actively
-- told the model how to offer installments as a negotiation tactic. That
-- template is now gated on isStcPortfolio in code; this migration adds the
-- matching written policy so the DB row and the code agree.
--
-- Idempotent: only appends if the exact sentence isn't already present
-- (so re-running this migration never double-appends).

update company_playbooks
set ai_instructions = ai_instructions || E'\nممنوع على الوكيل عرض أو اقتراح التقسيط في STC ابتداءً بأي شكل.\nإذا طلب العميل التقسيط بنفسه وبشكل صريح فقط: سجّل الطلب وارفعه للمراجعة بدون أي وعد أو موافقة منك، ودون اقتراح جدول أو مبلغ شهري أو عدد دفعات من عندك.'
where portfolio_id = (select id from portfolios where name in ('إس تي سي', 'STC', 'اس تي سي'))
  and ai_instructions not like '%ممنوع على الوكيل عرض أو اقتراح التقسيط في STC%';
