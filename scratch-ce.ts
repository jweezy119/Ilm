export const CrossExaminationResponseSchema = z.object({
  query: z.string(),
  resultsByCorpus: z.record(TextIdSchema, z.object({
    verdict: CorpusVerdictSchema,
    passages: z.array(SearchResultSchema),
  })),
  source: ScoreSourceSchema,
});
export type CrossExaminationResponse = z.infer<typeof CrossExaminationResponseSchema>;
