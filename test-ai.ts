import { runCollectorAgent } from './src/lib/ai-collector-agent.ts';
import 'dotenv/config';

(async () => {
  try {
    const res = await runCollectorAgent({
      company_id: 'test-company',
      customer_id: 'test-customer',
      message: 'مساء النور بخصوص المديونية متى اسدد',
      conversation_history: []
    });
    console.log("Success:", res);
  } catch(e) {
    console.error("Error caught:", e);
  }
})();
