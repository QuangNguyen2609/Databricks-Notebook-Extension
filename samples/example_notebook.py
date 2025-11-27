# Databricks notebook source
# MAGIC %md
# MAGIC # Example Databricks Notebook
# MAGIC
# MAGIC This is a sample notebook demonstrating the Databricks .py format.
# MAGIC
# MAGIC ## Features
# MAGIC - Markdown cells with rich formatting
# MAGIC - Python code cells
# MAGIC - SQL queries
# MAGIC - Shell commands

# COMMAND ----------

# DBTITLE 0,Import Libraries
import pandas as pd
import numpy as np
from pyspark.sql import SparkSession

# Initialize Spark session
spark = SparkSession.builder.getOrCreate()

# COMMAND ----------

# MAGIC %md
# MAGIC ## Data Loading
# MAGIC
# MAGIC Load sample data from the default database.

# COMMAND ----------

# DBTITLE 0,Load Sample Data
# Create sample DataFrame
data = {
    'id': range(1, 6),
    'name': ['Alice', 'Bob', 'Charlie', 'Diana', 'Eve'],
    'score': [85, 92, 78, 95, 88]
}

df = pd.DataFrame(data)
print(df)

# COMMAND ----------

# MAGIC %sql
# MAGIC -- Query example using SQL
# MAGIC SELECT
# MAGIC   id,
# MAGIC   name,
# MAGIC   score,
# MAGIC   CASE
# MAGIC     WHEN score >= 90 THEN 'A'
# MAGIC     WHEN score >= 80 THEN 'B'
# MAGIC     WHEN score >= 70 THEN 'C'
# MAGIC     ELSE 'D'
# MAGIC   END as grade
# MAGIC FROM sample_table
# MAGIC ORDER BY score DESC

# COMMAND ----------

# MAGIC %sh
# MAGIC # Shell command example
# MAGIC echo "Current directory:"
# MAGIC pwd
# MAGIC echo ""
# MAGIC echo "Files in directory:"
# MAGIC ls -la

# COMMAND ----------

# MAGIC %pip install transformers torch

# COMMAND ----------

# DBTITLE 0,Data Visualization
import matplotlib.pyplot as plt

# Create a simple bar chart
plt.figure(figsize=(10, 6))
plt.bar(df['name'], df['score'], color='steelblue')
plt.xlabel('Student')
plt.ylabel('Score')
plt.title('Student Scores')
plt.ylim(0, 100)
plt.show()

# COMMAND ----------

# MAGIC %md
# MAGIC ## Summary
# MAGIC
# MAGIC This notebook demonstrated:
# MAGIC 1. Markdown formatting
# MAGIC 2. Python code execution
# MAGIC 3. SQL queries
# MAGIC 4. Shell commands
# MAGIC 5. Package installation with `%pip`
# MAGIC
# MAGIC For more information, visit the [Databricks documentation](https://docs.databricks.com/).
