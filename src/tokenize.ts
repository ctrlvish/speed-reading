export function tokenizeArticleText(text: string): string[] {
    const normalizedText = text.replace(/\s+/gu, " ").trim();
    const textWithRecoveredBoundaries = normalizedText.replace(
        /[.!?]["'’”)}\]]*/gu,
        (boundary, offset: number, source: string) => {
            const followingText = source.slice(offset + boundary.length);
            const nextUppercaseLetter = followingText.match(/^\p{Lu}/u)?.[0];

            if (!nextUppercaseLetter) {
                return boundary;
            }

            if (boundary.startsWith(".")) {
                const previousCharacter = Array.from(source.slice(0, offset)).at(-1) ?? "";
                const characterAfterNext = followingText.slice(nextUppercaseLetter.length, nextUppercaseLetter.length + 1);
                const isInternalInitialismPeriod =
                    /^\p{Lu}$/u.test(previousCharacter) && characterAfterNext === ".";

                if (isInternalInitialismPeriod) {
                    return boundary;
                }
            }

            return `${boundary} `;
        },
    );

    const textWithCompoundBoundaries = textWithRecoveredBoundaries.replace(
        /(\p{L}[-‐‑])(?=\p{L})/gu,
        "$1 ",
    );

    return textWithCompoundBoundaries.match(/\S+/gu) ?? [];
}
