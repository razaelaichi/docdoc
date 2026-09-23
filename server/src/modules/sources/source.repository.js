import { toMongoSort } from "../../lib/pagination.js";
import { Source } from "./source.model.js";

export const createSource = (data) => Source.create(data);
export const findSource = (sourceId, caseId) => Source.findOne({ _id: sourceId, caseId }).lean();

export async function listSources(caseId, { page, limit, sort }) {
  const [items, total] = await Promise.all([
    Source.find({ caseId }).sort(toMongoSort(sort)).skip((page - 1) * limit).limit(limit).lean(),
    Source.countDocuments({ caseId }),
  ]);
  return { items, total };
}
