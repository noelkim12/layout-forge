import type { Answer, DependsOn, QuestionDefinition } from "./types"

function toStringArray(value: string | string[] | number | boolean): string[] {
  if (Array.isArray(value)) {
    return value
  }

  if (typeof value === "string") {
    return [value]
  }

  return []
}

function evaluateIncludes(answer: Answer, depValue: string | string[]): boolean {
  const answerValues = toStringArray(answer.value)
  const dependencyValues = toStringArray(depValue)

  if (answerValues.length === 0 || dependencyValues.length === 0) {
    return false
  }

  return dependencyValues.some((value) => answerValues.includes(value))
}

export function evaluateDependsOn(dep: DependsOn, answers: Record<string, Answer>): boolean {
  const answer = answers[dep.questionId]

  if (!answer) {
    return false
  }

  if (dep.operator === "eq") {
    return typeof answer.value === "string" && typeof dep.value === "string" && answer.value === dep.value
  }

  if (dep.operator === "neq") {
    return typeof answer.value === "string" && typeof dep.value === "string" && answer.value !== dep.value
  }

  if (dep.operator === "includes") {
    return evaluateIncludes(answer, dep.value)
  }

  return !evaluateIncludes(answer, dep.value)
}

export function getApplicableQuestions(
  questions: QuestionDefinition[],
  answers: Record<string, Answer>,
): QuestionDefinition[] {
  return questions.filter((question) => {
    if (!question.dependsOn) {
      return true
    }

    return evaluateDependsOn(question.dependsOn, answers)
  })
}

export function getNextQuestion(
  questions: QuestionDefinition[],
  answers: Record<string, Answer>,
  currentQuestionId: string,
): QuestionDefinition | null {
  const currentIndex = questions.findIndex((question) => question.id === currentQuestionId)

  if (currentIndex < 0) {
    return null
  }

  for (let index = currentIndex + 1; index < questions.length; index += 1) {
    const question = questions[index]

    if (!question.dependsOn || evaluateDependsOn(question.dependsOn, answers)) {
      return question
    }
  }

  return null
}

export function getCurrentQuestion(
  questions: QuestionDefinition[],
  answers: Record<string, Answer>,
  currentIndex: number,
): QuestionDefinition | null {
  const applicableQuestions = getApplicableQuestions(questions, answers)
  return applicableQuestions[currentIndex] ?? null
}

export function getProgress(
  questions: QuestionDefinition[],
  answers: Record<string, Answer>,
): { answered: number; total: number; percentage: number } {
  const applicableQuestions = getApplicableQuestions(questions, answers)
  const total = applicableQuestions.length
  const answered = applicableQuestions.filter((question) => answers[question.id] !== undefined).length
  const percentage = total === 0 ? 0 : Math.round((answered / total) * 100)

  return { answered, total, percentage }
}
