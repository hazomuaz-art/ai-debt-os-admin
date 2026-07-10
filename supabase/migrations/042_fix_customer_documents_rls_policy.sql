BEGIN;

drop policy if exists "company_scoped_select_customer_documents" on customer_documents;
create policy "View customer_documents in company" on customer_documents
  for select using (company_id = get_user_company_id());
create policy "Create customer_documents in company" on customer_documents
  for insert with check (company_id = get_user_company_id());

COMMIT;
