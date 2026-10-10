"""Offline unit tests for the guardrails that don't need the AI: masking, citations, rules, scope.
Run: python3 -m unittest discover -s tests -v"""
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from aca.citations import verify  # noqa: E402
from aca.masking import Masker, residual_leaks  # noqa: E402
from aca.parsing import deadline_from_notes, out_of_scope_reason  # noqa: E402
from aca.rules import run_rules  # noqa: E402

PARTY = ('ATLIQ TECHNOLOGIES PRIVATE LIMITED (CIN U72900MH2019PTC321456; GSTIN 27AAKCA4821F1Z3), having its registered '
         'office at 4th Floor, Baner Business Bay, Pune 411045, Maharashtra, India ("Vendor"). Contact: priya@client.example, '
         '+971 4 555 0190. TravelHub FZ-LLC, licensed under licence no. 104772, with its office at Office 1408, Building 3, '
         'Dubai Internet City, P.O. Box 502211, Dubai ("Customer"). Bank: Account No. 123456789012, IFSC HDFC0001234.')


class Masking(unittest.TestCase):
    def test_ids_masked_and_atliq_labelled(self):
        m = Masker()
        out = m.mask(PARTY)
        for secret in ("U72900MH2019PTC321456", "27AAKCA4821F1Z3", "Baner Business Bay", "priya@client.example",
                       "104772", "Dubai Internet City", "123456789012", "HDFC0001234", "555 0190"):
            self.assertNotIn(secret, out, secret)
        self.assertIn("[ATLIQ_PVT_LTD_GSTIN]", out)
        self.assertIn("[ATLIQ_PVT_LTD_ADDRESS]", out)
        self.assertIn("TravelHub FZ-LLC", out)  # party names are not masked
        self.assertEqual(residual_leaks(out), [])
        self.assertEqual(m.unmask(out), PARTY)

    def test_patient_lines_withheld(self):
        m = Masker()
        out = m.mask("Scope text\n| Maria Gonzalez | DOB: 03/14/1962 | MRN: 448812 | E11.9 |\nMore text")
        self.assertNotIn("Maria", out)
        self.assertIn("[WITHHELD", out)
        self.assertEqual(len(m.withheld), 1)

    def test_definitions_are_not_withheld(self):
        m = Masker()
        out = m.mask('"Protected Health Information" or "PHI" has the meaning given in 45 C.F.R. 160.103.')
        self.assertNotIn("WITHHELD", out)


class Citations(unittest.TestCase):
    def test_exact_with_markdown_and_ellipsis(self):
        text = 'The Service Provider shall retain ownership of its pre-existing tools ("**Background IP**"). The licence is perpetual.'
        self.assertTrue(verify('retain ownership of its pre-existing tools ("Background IP")... licence is perpetual', text)[0])

    def test_invented_quote_rejected(self):
        self.assertFalse(verify("AtliQ may terminate at any time without paying", "Client may terminate on 7 days notice.")[0])


class Scope(unittest.TestCase):
    def test_freelancer_out(self):
        self.assertTrue(out_of_scope_reason("# INDEPENDENT CONTRACTOR AGREEMENT\nMarcus Reed, an individual residing at ..."))
        self.assertIsNone(out_of_scope_reason("# MASTER SERVICES AGREEMENT\nBetween Gulf Crown and AtliQ"))

    def test_deadline(self):
        self.assertEqual(deadline_from_notes("sign by 10 Oct!! Faisal has a summit"), "2026-10-10")
        self.assertEqual(deadline_from_notes("needed before 1 Oct data walkthrough"), "2026-10-01")


def kt(**over):
    base = dict(atliq_side="supplier", counterparty_country="United Arab Emirates", counterparty_sector="travel", doc_type="Services agreement",
                signing_entity="AtliQ Inc", signing_entity_ref="1.2", signing_entity_quote="AtliQ Inc, a Delaware corporation",
                invoicing_entity="AtliQ Technologies Pvt Ltd", invoicing_ref="7.1", invoicing_quote="raised by AtliQ Technologies Pvt Ltd",
                governing_law="Laws of the Emirate of Dubai", governing_law_ref="15.1", governing_law_quote="laws of the Emirate of Dubai",
                dispute_venue="Dubai courts", venue_ref="15.2", venue_quote="courts of Dubai", prevailing_language="English",
                contract_value_usd=52000, liability_uncapped=False, liability_cap_text="fees paid", liability_cap_usd=52000,
                liability_multiple_of_fees=1, liability_ref="10", liability_quote="fees paid", ld_present=False, ld_uncapped=False,
                ld_text="", ld_client_delay_excluded="not_applicable", ld_ref="", ld_quote="", indemnity_mutual=True,
                indemnity_covers_counterparty_negligence=False, indemnity_capped=True, indemnity_ref="", indemnity_quote="",
                payment_days=30, payment_ref="7.2", handles_personal_data=False, handles_phi=False, data_subject_countries=[],
                data_ref="", data_quote="", baa_included=False, dpa_included=False, companion_documents=[], insurance=[])
    base.update(over)
    return base


class Rules(unittest.TestCase):
    def test_wrong_entity_and_invoicing(self):
        flags, checks, _ = run_rules(kt(), {"id": "d", "counterparty": "TravelHub", "doc_type": "Services agreement"}, [])
        topics = {f["topic"] for f in flags}
        self.assertIn("entity_mismatch", topics)
        self.assertIn("invoicing", topics)

    def test_uncapped_and_disproportionate(self):
        flags, _, _ = run_rules(kt(liability_uncapped=True), {"id": "d", "value_usd": 52000}, [])
        self.assertTrue(any(f["topic"] == "liability_cap" and f["severity"] == "critical" for f in flags))
        flags, _, _ = run_rules(kt(liability_cap_usd=500000, liability_multiple_of_fees=0), {"id": "d", "value_usd": 24000}, [])
        self.assertTrue(any(f["topic"] == "liability_cap" and f["severity"] == "high" for f in flags))

    def test_healthcare_needs_signed_baa(self):
        k = kt(counterparty_country="United States", counterparty_sector="healthcare", signing_entity="AtliQ Inc",
               invoicing_entity="not stated", governing_law="Texas", handles_personal_data=True, handles_phi=True)
        doc = {"id": "m", "counterparty": "Harrington Health Systems Inc", "doc_type": "MSA"}
        others = [{"id": "n", "counterparty": "Harrington Health Systems Inc", "doc_type": "NDA", "role": "signed"},
                  {"id": "b", "counterparty": "Harrington Health Systems Inc", "doc_type": "BAA", "role": "incoming"}]
        flags, _, bundle = run_rules(k, doc, others)
        self.assertTrue(any(f["topic"] == "phi_baa" and f["severity"] == "critical" for f in flags))
        self.assertTrue(any("HIPAA" in r["name"] for r in bundle["regulations"]))
        others.append({"id": "s", "counterparty": "Harrington Health Systems Inc", "doc_type": "BAA", "role": "signed"})
        flags, _, _ = run_rules(k, doc, others)
        self.assertFalse(any(f["topic"] == "phi_baa" for f in flags))

    def test_india_contract_clean(self):
        k = kt(counterparty_country="India", signing_entity="AtliQ Technologies Pvt Ltd", invoicing_entity="AtliQ Technologies Pvt Ltd",
               governing_law="Laws of India", dispute_venue="Arbitration in Pune")
        flags, _, _ = run_rules(k, {"id": "d", "value_usd": 45000}, [])
        self.assertEqual(flags, [])


if __name__ == "__main__":
    unittest.main()
