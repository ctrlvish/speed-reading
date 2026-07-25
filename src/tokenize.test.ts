import assert from "node:assert/strict";
import test from "node:test";
import { tokenizeArticleText } from "./tokenize";

test("splits missing whitespace at sentence boundaries", () => {
    assert.deepEqual(
        tokenizeArticleText("First sentence.Second sentence.Wait!Next Really?Yes"),
        ["First", "sentence.", "Second", "sentence.", "Wait!", "Next", "Really?", "Yes"],
    );
});

test("keeps closing punctuation with the preceding sentence", () => {
    assert.deepEqual(
        tokenizeArticleText('He said “stop.”Next She replied (quietly.)Then left.'),
        ["He", "said", "“stop.”", "Next", "She", "replied", "(quietly.)", "Then", "left."],
    );
});

test("does not split decimals, domains, or internal acronym periods", () => {
    assert.deepEqual(
        tokenizeArticleText("Use 3.14 at example.com in the U.S.A.Next sentence."),
        ["Use", "3.14", "at", "example.com", "in", "the", "U.S.A.", "Next", "sentence."],
    );
});

test("splits hyphenated compounds and keeps each hyphen with the preceding part", () => {
    assert.deepEqual(
        tokenizeArticleText("An all-consuming, state-of-the-art idea costs -5."),
        ["An", "all-", "consuming,", "state-", "of-", "the-", "art", "idea", "costs", "-5."],
    );
});
