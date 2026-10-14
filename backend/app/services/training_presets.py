"""Server-owned checks for the training centre's built-in practice tasks."""
PRESETS = {
    "circular-queue": {
        "title": "循环队列：让数据有序流转", "course": "数据结构", "points": ["队列", "数组", "边界处理"], "function": "solve",
        "cases": [([3, [["enqueue", 10], ["enqueue", 20], ["dequeue"], ["dequeue"]]], [10, 20]),
                  ([2, [["dequeue"], ["enqueue", 0], ["dequeue"], ["dequeue"]]], [None, 0, None]),
                  ([1, [["enqueue", 3], ["enqueue", 4], ["dequeue"], ["enqueue", 5], ["dequeue"]]], [3, 5]),
                  ([2, [["enqueue", 1], ["enqueue", 2], ["dequeue"], ["enqueue", 3], ["dequeue"], ["enqueue", 4], ["dequeue"], ["dequeue"]]], [1, 2, 3, 4])],
    },
    "bracket-matching": {
        "title": "括号匹配：读懂嵌套结构", "course": "数据结构", "points": ["栈", "字符串", "条件判断"], "function": "is_balanced",
        "cases": [(["a * (b + [c - {d}])"], True), (["([)]"], False), ([""], True), (["]abc"], False), (["(()"], False)],
    },
    "binary-search": {
        "title": "二分查找：缩小问题的范围", "course": "Python 程序设计", "points": ["查找", "循环", "边界处理"], "function": "binary_search",
        "cases": [([[2, 5, 8, 12, 16], 8], 2), ([[-5, 0, 3, 9], -5], 0), ([[-5, 0, 3, 9], 9], 3),
                  ([[2, 5, 8, 12, 16], 7], -1), ([[], 3], -1), ([[3], 3], 0), ([[3], 4], -1)],
    },
}
